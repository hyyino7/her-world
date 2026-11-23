"""P2 provider-port checks, synthetic callers only; no native consumer claims."""
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "vendor/mnemosyne/service/src"), str(ROOT / "src/memory")]
from cognitive_memory.bootstrap import build_context
from cognitive_memory.core.service import ConflictError, NotFoundError
from cognitive_memory.evidence.derivation import DerivationStore
from cognitive_memory.domain.models import MemoryUpdateIn, MemoryProposeIn, ObservationIn
from provider import MemoryPort
from memory_faults import withdrawal_fault


class ProviderConformance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.open()

    def open(self):
        self.ctx = build_context(data_dir=self.tmp.name, token="disposable-fixture")
        self.port = MemoryPort(self.ctx.service, companion_id="pet", scope_id="owner", workspace_id="repo")
        self.scope = self.port.scope

    def tearDown(self):
        self.ctx.runtime.stop()
        self.ctx.db.close()
        self.tmp.cleanup()

    def source(self, key, content):
        result = self.port.observe(self.scope, source_id=key, content=content, revision="1", actor_id="owner")
        return {"id": key, "revision": "1"}, result

    def memory(self, key, text):
        source, _ = self.source(key, text)
        return self.port.propose(self.scope, operation_id=key, content=text, sources=[source]), source

    def interaction(self, key="grant", content="The owner gave me 50 coins; wallet balance is 144."):
        source_id = "native-fact:" + key
        result = self.port.observe(self.scope, source_id=source_id, revision="1", content=content,
            source_kind="system", actor_id="owner", occurred_at="2026-11-15T07:17:52Z",
            attribution={"kind": "owner", "domain": "economy", "factId": "economy:" + key,
                         "channel": "settings", "observedInSessionId": "owner-A"})
        return {"id": source_id, "revision": "1"}, result

    def test_completed_interaction_is_recalled_as_system_evidence_in_another_chat(self):
        # A has consumed delivery; B uses the Bank normally, with no second
        # observeFacts call or known fact ID supplied by its caller.
        with patch("socket.socket.connect", side_effect=AssertionError("network forbidden")):
            source, _ = self.interaction()
            self.assertEqual(self.port.source_decision(source["id"]), "eligible")
            recalled = self.port.context(self.scope, query="Did it work?", include_recent=True, max_chars=24000)
            self.assertEqual(len(recalled["records"]), 1)
            record = recalled["records"][0]
            self.assertEqual(record["interactions"][0]["role"], "system")
            self.assertEqual(record["interactions"][0]["occurred_at"], "2026-11-15T07:17:52Z")
            self.assertIn("50 coins", recalled["text"])
            self.assertIn('"source_roles": ["system"]', recalled["text"])
            self.assertNotIn('"role": "user"', recalled["text"])
            detail = self.port.read(self.scope, memory_id=record["memory"]["id"])
            self.assertEqual(detail["conversation"][0]["role"], "system")
            self.assertEqual(self.port.materialize(self.scope, sources=[source])[0]["text"],
                             "The owner gave me 50 coins; wallet balance is 144.")
            self.assertFalse(self.port.recall(self.scope, query="50 coins", include_recent=True,
                                             exclude_sources=[source["id"]])["records"])

    def test_transport_is_retained_without_another_experience_or_generic_system_recall(self):
        from cognitive_memory.cognition.consolidate import consolidate_observation
        source, _ = self.interaction()
        envelope = self.port.observe(self.scope, source_id="native-input:delivery", revision="1",
            content='{"facts": ["transport bytes"]}', actor_id="system:companion-world",
            source_kind="system", roots=[source])
        self.assertIsNone(consolidate_observation(self.ctx.service, envelope["observationId"]))
        self.assertEqual(self.port.source_decision("native-input:delivery"), "eligible")
        self.assertEqual(self.port.source("native-input:delivery")["content"], '{"facts": ["transport bytes"]}')
        self.port.observe(self.scope, source_id="native-input:alarm", revision="1", content="50 coins alarm",
            actor_id="system", source_kind="system")
        recalled = self.port.recall(self.scope, query="50 coins", include_recent=True)
        self.assertEqual(len(recalled["records"]), 1)
        self.assertEqual(recalled["records"][0]["dependencies"]["sources"], [source])
        self.ctx.runtime.dispatch_outbox_once(); self.ctx.runtime.run_tasks_once()
        self.assertFalse(self.ctx.db.connect().execute(
            "SELECT 1 FROM memory_evidence WHERE observation_id=?", (envelope["observationId"],)).fetchone())

    def test_legacy_interaction_projection_repairs_once_and_keeps_originals_and_versions(self):
        from cognitive_memory.cognition.consolidate import consolidate_observation
        # Legacy captures have scope on the source, but consolidation dropped it.
        legacy_scope = {"companionId": "pet", "scopeId": "owner", "workspaceId": "repo"}
        wire_scope = {"companionId": "pet", "scopeId": "owner", "bankId": "repo"}
        def legacy(key, text, attribution, roots):
            return self.ctx.service.capture_observation(ObservationIn(source_kind="system", content=text,
                producer="dsh", idempotency_key="pet:observation:" + key,
                metadata={"workspace_id": "repo", "pet_scope": legacy_scope,
                    "actor_id": "owner", "pet_roots": roots, "attribution": attribution,
                    "source_ref": {"source_id": key, "root_source_id": key, "revision": "1"}}))
        original = legacy("native-fact:legacy", "The owner gave me 50 coins.",
            {"kind": "owner", "domain": "economy", "factId": "economy:legacy", "channel": "settings"}, [])
        episode_id = consolidate_observation(self.ctx.service, original.id)
        before = self.ctx.service.get_memory(episode_id)
        envelope = legacy("native-input:legacy", '{"facts":"old transport"}', {}, [{"id": "native-fact:legacy", "revision": "1"}])
        envelope_episode = consolidate_observation(self.ctx.service, envelope.id)
        self.ctx.db.close(); self.open()
        repaired = self.ctx.service.get_memory(episode_id)
        self.assertEqual(repaired["content"], before["content"])
        self.assertEqual(repaired["version"], before["version"] + 1)
        self.assertTrue(repaired["metadata"]["pet_interaction"])
        self.assertEqual(self.ctx.service.get_memory(envelope_episode)["content"], '{"facts":"old transport"}')
        self.assertEqual(consolidate_observation(self.ctx.service, envelope.id), envelope_episode,
                         "an already stored transport candidate keeps its original ID")
        request_scope = self.port.scope_for_request(wire_scope)
        self.assertEqual([r["memory"]["id"] for r in self.port.recall(request_scope, query="50 coins", include_recent=True)["records"]], [episode_id])
        counts = tuple(self.ctx.db.connect().execute("SELECT (SELECT COUNT(*) FROM observations), (SELECT COUNT(*) FROM memories), (SELECT COUNT(*) FROM memory_versions)").fetchone())
        self.ctx.db.close(); self.open()
        self.assertEqual(self.ctx.service.get_memory(episode_id)["version"], repaired["version"])
        self.assertEqual(counts, tuple(self.ctx.db.connect().execute("SELECT (SELECT COUNT(*) FROM observations), (SELECT COUNT(*) FROM memories), (SELECT COUNT(*) FROM memory_versions)").fetchone()))
        self.assertEqual(self.port.source("native-fact:legacy")["content"], original.content)
        request_scope = self.port.scope_for_request(wire_scope)
        self.port.withdraw(request_scope, memory_id=episode_id, expected_version=repaired["version"])
        self.assertFalse(self.port.recall(request_scope, query="50 coins", include_recent=True)["records"])
        self.assertEqual(self.port.source("native-fact:legacy")["metadata"]["pet_scope"], legacy_scope)

    def test_capture_commit_can_immediately_consolidate_without_a_duplicate_envelope(self):
        from cognitive_memory.cognition.consolidate import consolidate_observation
        capture = self.ctx.service.capture_observation
        interleaved = []
        def consolidate_after_capture(body):
            observation = capture(body)
            # The worker wins before observe returns from capture and can run
            # its post-capture repair. Exercise the real consolidation entry.
            interleaved.append((observation.id, consolidate_observation(self.ctx.service, observation.id)))
            return observation
        with patch.object(self.ctx.service, "capture_observation", side_effect=consolidate_after_capture):
            source, _ = self.interaction()
            original_memory = interleaved[-1][1]
            envelope = self.port.observe(self.scope, source_id="native-input:interleaved", revision="1",
                content='{"facts":"delivery bytes"}', actor_id="system:companion-world",
                source_kind="system", roots=[source])
        self.assertEqual(interleaved[-1], (envelope["observationId"], None))
        self.assertEqual(self.port.recall(self.scope, query="50 coins")["records"][0]["memory"]["id"], original_memory)
        self.assertEqual(self.ctx.service.get_memory(original_memory)["version"], 1)
        self.assertEqual(self.ctx.db.connect().execute("SELECT COUNT(*) FROM memories").fetchone()[0], 1)

    def test_interaction_projection_keeps_withdrawal_and_scope_isolation(self):
        source, _ = self.interaction()
        memory = self.port.recall(self.scope, query="50 coins")["records"][0]["memory"]
        foreign = MemoryPort(self.ctx.service, companion_id="other", scope_id="other-owner", workspace_id="foreign")
        self.assertFalse(foreign.recall(foreign.scope, query="50 coins", include_recent=True)["records"])
        with self.assertRaises(PermissionError):
            foreign.read(foreign.scope, memory_id=memory["id"])
        # Rebind the single service's guard to the original port, as production
        # has one selected Bank/port at a time.
        self.port = MemoryPort(self.ctx.service, companion_id="pet", scope_id="owner", workspace_id="repo")
        self.port.withdraw(self.scope, memory_id=memory["id"], expected_version=memory["version"])
        self.ctx.db.close(); self.open()
        self.assertFalse(self.port.recall(self.scope, query="50 coins", include_recent=True)["records"])
        with self.assertRaises(ConflictError):
            self.port.read(self.scope, memory_id=memory["id"])
        self.assertIsNotNone(self.port.source(source["id"]), "withdrawal keeps the original source")

    def test_missing_context_observation_keeps_the_provider_error_and_bank(self):
        def counts():
            conn = self.ctx.db.connect()
            return tuple(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                         for table in ("observations", "memories"))

        before = counts()
        for reopened in (False, True):
            if reopened:
                self.ctx.runtime.stop()
                self.ctx.db.close()
                self.open()
            with self.assertRaisesRegex(NotFoundError, "conversation observation missing"):
                self.port.consolidate_context("missing-conversation-observation")
            self.assertEqual(counts(), before)
            self.assertEqual(self.ctx.db.connect().execute("SELECT 1").fetchone()[0], 1)

    def test_explicit_archive_reuses_checkpoint_and_respects_withdrawal(self):
        turn, _ = self.source("native-user", "Next time we will compare the two sketches.")
        durable, _ = self.memory("fact", "I prefer the red sketch.")
        first = self.port.archive(self.scope, session_id="native-1", sources=[turn["id"], "fact"])
        self.assertEqual(first, self.port.archive(self.scope, session_id="native-1", sources=[turn["id"], "fact"]))
        self.assertEqual(len(self.port.latest_archive(8)), 2)
        self.port.withdraw(self.scope, memory_id=durable["id"], expected_version=durable["version"])
        context = self.port.context(self.scope, query="continue", include_recent=True, max_chars=24000)
        self.assertIn("Next time we will compare", context["text"])
        self.assertNotIn("I prefer the red sketch", context["text"])
        with self.assertRaises(PermissionError):
            self.port.archive(dict(self.scope, workspaceId="elsewhere"), session_id="native-1", sources=["fact"])

    def test_scope_replay_and_provider_processing_recovery(self):
        with self.assertRaises(PermissionError):
            self.port.recall(dict(self.scope, workspaceId="foreign"), query="")
        source, first = self.source("source-a", "The owner prefers tea")
        self.ctx.db.close()
        self.open()
        _, replay = self.source("source-a", "The owner prefers tea")
        self.assertEqual(first["observationId"], replay["observationId"])
        self.assertEqual(replay["state"], "duplicate")
        with self.assertRaises(ConflictError):
            self.source("source-a", "Changed replay payload")
        # Run the actual provider dispatcher after restart, not a replacement queue.
        self.ctx.runtime.dispatch_outbox_once()
        self.ctx.runtime.run_tasks_once()
        memory = self.port.propose(self.scope, operation_id="process-a", content="The owner prefers tea", sources=[source])
        replay_memory = self.port.propose(self.scope, operation_id="process-a", content="The owner prefers tea", sources=[source])
        self.assertEqual(memory["id"], replay_memory["id"])
        recalled = self.port.recall(self.scope, query="tea")
        self.assertEqual(recalled["coverage"], "partial")
        self.assertTrue(any(record["memory"]["id"] == memory["id"] for record in recalled["records"]))

    def test_correction_revision_and_late_extraction(self):
        memory, old = self.memory("old-source", "The owner prefers tea")
        new, _ = self.source("new-source", "The owner now prefers coffee")
        corrected = self.port.correct(self.scope, memory_id=memory["id"], expected_version=1,
                                      content="The owner prefers coffee", sources=[new])
        self.assertEqual(corrected["version"], 2)
        with self.assertRaises(ConflictError):
            self.port.correct(self.scope, memory_id=memory["id"], expected_version=1, content="stale", sources=[new])
        with self.assertRaises(ConflictError):
            self.port.propose(self.scope, operation_id="delayed-old", content="The owner prefers tea", sources=[old])
        self.assertEqual(self.port.validate(self.scope, sources=[old])["decision"], "ineligible")
        self.assertEqual(self.port.validate(self.scope, sources=[{"id": "new-source"}])["decision"], "unknown")
        check = self.port.derivations.recheck_revisions([old], current_revisions={})
        self.assertFalse(check["chosen_allowed"])
        recalled = self.port.recall(self.scope, query="coffee")
        self.assertEqual(recalled["records"][0]["memory"]["content"], "The owner prefers coffee")

    def test_partial_withdrawal_is_shared_and_survives_restart(self):
        for fault in ("cascade", "tombstone"):
            with self.subTest(fault=fault):
                memory, source = self.memory(f"secret-{fault}", f"Sensitive synthetic preference {fault}")
                healthy, healthy_source = self.memory(f"healthy-{fault}", "Unrelated owner fact")
                with withdrawal_fault(fault):
                    result = self.port.withdraw(self.scope, memory_id=memory["id"], expected_version=1)
                self.assertEqual(result["withdrawal_state"], "pending")
                for consumer in ("core", "chat", "audio"):
                    self.assertEqual(self.port.validate(self.scope, sources=[source])["decision"], "ineligible", consumer)
                    self.assertEqual(self.port.validate(self.scope, sources=[healthy_source])["decision"], "eligible", consumer)
                self.ctx.db.close()
                self.open()
                self.assertEqual(self.port.validate(self.scope, sources=[source])["decision"], "ineligible")
                settled = self.port.recover(self.scope)
                self.assertTrue(settled and all(item["withdrawal_state"] == "settled" for item in settled))
                self.assertFalse(self.ctx.service.withdrawal_status())
                self.assertEqual(self.port.validate(self.scope, sources=[source])["decision"], "ineligible")
                self.assertEqual(self.port.validate(self.scope, sources=[healthy_source])["decision"], "eligible")
                self.assertEqual(self.source(source["id"], f"Sensitive synthetic preference {fault}")[1]["decision"], "ineligible")
                with self.assertRaises(ConflictError):
                    self.port.propose(self.scope, operation_id=f"revive-{fault}", content="revive", sources=[source])

    def test_provider_temporal_eligibility_uses_injected_time(self):
        memory, source = self.memory("temporary", "Temporary preference")
        current = self.ctx.service.update_memory(memory["id"], MemoryUpdateIn(expected_version=1, expires_at="2026-11-06T00:00:00Z"))
        dependencies = dict(sources=[source], memories=[{"id": current.id, "revision": str(current.version)}])
        self.port.clock = lambda: datetime(2026, 11, 5, tzinfo=timezone.utc)
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "eligible")
        self.port.clock = lambda: datetime(2026, 11, 7, tzinfo=timezone.utc)
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "ineligible")

    def test_upstream_derivation_rebuild_controls_eligibility_without_a_mirrored_status(self):
        memory, source = self.memory("derived-fact", "An attributed derived fact")
        dependencies = dict(sources=[source], memories=[{"id": memory["id"], "revision": "1"}])
        native = self.port.derivations
        native.register(derived_id=memory["id"], artifact_kind="memory", dependencies=[source], processor_version="fixture")
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "eligible")
        native.begin_rebuild(memory["id"])
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "unknown")
        native.finish_rebuild(memory["id"], success=False)
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "unknown")
        self.assertFalse(self.port.context(self.scope, query="derived", max_chars=2000)["records"])
        native.finish_rebuild(memory["id"], success=True, dependencies=[source])
        self.assertEqual(self.port.validate(self.scope, **dependencies)["decision"], "eligible")
        self.assertTrue(self.port.context(self.scope, query="derived", max_chars=2000)["records"])

    def test_unrelated_fact_from_the_same_message_survives_correction(self):
        source, _ = self.source("mixed-source", "Owner prefers tea. Owner lives in Hue.")
        preference = self.port.propose(self.scope, operation_id="mixed-pref", content="Owner prefers tea.", sources=[source], evidence_quotes=["Owner prefers tea."])
        city = self.port.propose(self.scope, operation_id="mixed-city", content="Owner lives in Hue.", sources=[source], evidence_quotes=["Owner lives in Hue."])
        correction, _ = self.source("mixed-correction", "Owner now prefers coffee.")
        self.port.correct(self.scope, memory_id=preference["id"], expected_version=1, content="Owner prefers coffee.", sources=[correction])
        records = self.port.recall(self.scope, query="Hue")["records"]
        self.assertTrue(any(item["memory"]["id"] == city["id"] for item in records), "Independent fact in a mixed message must remain usable")
        for quote in ["Owner prefers tea.", "Owner prefers tea. Owner lives in Hue."]:
            with self.assertRaises(ConflictError):
                self.port.propose(self.scope, operation_id="mixed-revive", content="Owner prefers tea.", sources=[source], evidence_quotes=[quote])
        with withdrawal_fault("tombstone"):
            pending = self.port.withdraw(self.scope, memory_id=preference["id"], expected_version=2)
        self.assertEqual(pending["withdrawal_state"], "pending")
        self.assertTrue(any(item["memory"]["id"] == city["id"] for item in self.port.recall(self.scope, query="Hue")["records"]))
        self.ctx.db.close()
        self.open()
        self.assertTrue(all(result["withdrawal_state"] == "settled" for result in self.port.recover(self.scope)))
        self.assertTrue(any(item["memory"]["id"] == city["id"] for item in self.port.recall(self.scope, query="Hue")["records"]))
        with self.assertRaises(ConflictError):
            self.port.propose(self.scope, operation_id="mixed-reimport", content="Owner prefers tea.", sources=[source], evidence_quotes=["Owner prefers tea."])

    def test_completed_analysis_uses_upstream_candidate_context_and_scope_before_limit(self):
        source, _ = self.source("document-input", "Compare Cedar and Willow documents")
        evidence = self.port.propose(self.scope, operation_id="document-evidence", content="Cedar document supplied", sources=[source])
        first = self.port.observe(self.scope, source_id="completed-analysis", content="Cedar costs 3 USD less than Willow.",
            revision="1", actor_id="pet", source_kind="agent_inference", roots=[source], conversation_context=True)
        for index in range(55):
            self.ctx.service.propose_memory(MemoryProposeIn(type="episodic", content=f"Unrelated noisy episode {index}"))
        replay = self.port.observe(self.scope, source_id="completed-analysis", content="Cedar costs 3 USD less than Willow.",
            revision="1", actor_id="pet", source_kind="agent_inference", roots=[source], conversation_context=True)
        self.assertEqual(first["observationId"], replay["observationId"])
        context = [item for item in self.port.recall(self.scope, query="Cedar")["records"] if item["memory"]["type"] == "episodic"]
        self.assertEqual(len(context), 1, "Unscoped noise cannot consume the query's LIMIT before filtering")
        self.assertEqual(context[0]["memory"]["status"], "candidate")
        self.assertEqual(context[0]["memory"]["metadata"]["epistemic"], "summary")
        self.port.withdraw(self.scope, memory_id=evidence["id"], expected_version=1)
        self.assertFalse(self.port.recall(self.scope, query="Cedar")["records"])
        with self.assertRaises(ConflictError):
            self.ctx.service.propose_memory(MemoryProposeIn(type="episodic", content="Delayed old analysis",
                metadata={"pet_context": True, "pet_scope": self.scope, "pet_sources": [source]}))

    def test_relevant_fact_and_recent_full_reply_survive_busy_bank_without_reviving_withdrawn_context(self):
        relevant, _ = self.memory("violet", "Owner collects violet shells.")
        supporting, source = self.memory("comparison", "Compare the two supplied documents.")
        reply = "Background detail. " * 50 + "Final finding: Cedar costs 3 less; Willow arrives 3 days sooner."
        self.port.observe(self.scope, source_id="long-completed-reply", content=reply,
            revision="1", actor_id="pet", source_kind="agent_inference", roots=[source], conversation_context=True)
        for index in range(12):
            self.memory(f"fact-{index}", f"Independent unrelated fact number {index}.")
        direct = self.port.recall(self.scope, query="violet", limit=4)
        self.assertEqual(direct["records"][0]["memory"]["id"], relevant["id"])
        continued = self.port.recall(self.scope, query="continue", limit=4, include_recent=True)
        self.assertLessEqual(len(continued["records"]), 4)
        conversations = [part["text"] for record in continued["records"] for part in record.get("conversation", [])]
        self.assertIn(reply, conversations, "A follow-up must not lose the conclusion beyond the upstream summary's prefix")
        self.port.withdraw(self.scope, memory_id=supporting["id"], expected_version=1)
        after = self.port.recall(self.scope, query="continue", limit=4, include_recent=True)
        self.assertFalse(any(record.get("conversation") for record in after["records"]), "Recent-context fallback must obey the same withdrawal decision")

    def test_user_dialogue_is_recalled_with_attribution_without_a_semantic_tool_write(self):
        first = self.port.observe(self.scope, source_id="user-dialogue", revision="1",
            content="I prefer candid answers, even when the answer is uncertain.",
            actor_id="owner", source_kind="user_statement")
        self.port.consolidate_context(first["observationId"])
        result = self.port.recall(self.scope, query="candid", include_recent=True)
        self.assertTrue(any(part["text"].startswith("I prefer candid")
            for record in result["records"] for part in record.get("conversation", [])))
        context = self.port.context(self.scope, query="candid", max_chars=6000)
        materialized = self.port.materialize(self.scope, sources=[{"id": "user-dialogue", "revision": "1"}])
        self.assertEqual(materialized[0]["text"], "I prefer candid answers, even when the answer is uncertain.")
        self.assertIn('"source_roles": ["user_statement"]', context["text"])
        self.assertNotIn('"type": "semantic"', context["text"])
        self.assertIn('"role": "user"', context["text"])
        self.assertIn('"recorded_at":', context["text"])
        self.port.observe(self.scope, source_id="user-dialogue", revision="1",
            content="I prefer candid answers, even when the answer is uncertain.",
            actor_id="owner", source_kind="user_statement", conversation_context=True)
        with self.ctx.db.exclusive() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM memories WHERE type='episodic'").fetchone()[0], 1)
        self.port.derivations.record_tombstone(root_source_id="user-dialogue", reason="owner withdrew source")
        self.assertFalse(self.port.recall(self.scope, query="candid", include_recent=True)["records"])
        with self.assertRaises(ConflictError):
            self.port.materialize(self.scope, sources=[{"id": "user-dialogue", "revision": "1"}])

    def test_restart_projects_admitted_old_user_episodes_but_never_revives_withdrawn_sources(self):
        admitted = self.port.observe(self.scope, source_id="old-user", revision="1", actor_id="owner",
            source_kind="user_statement", content="I prefer a quiet room for reading.")
        blocked = self.port.observe(self.scope, source_id="old-withdrawn", revision="1", actor_id="owner",
            source_kind="user_statement", content="Previously withdrawn user material.")
        self.port.derivations.record_tombstone(root_source_id="old-withdrawn", reason="withdrawn")
        self.open_again_port = MemoryPort(self.ctx.service, companion_id="pet", scope_id="owner", workspace_id="repo")
        recalled = self.open_again_port.recall(self.scope, query="quiet reading", include_recent=True)
        self.assertTrue(any(part["text"].startswith("I prefer a quiet room")
            for record in recalled["records"] for part in record.get("conversation", [])))
        self.assertFalse(any("withdrawn user material" in part["text"]
            for record in recalled["records"] for part in record.get("conversation", [])))
        MemoryPort(self.ctx.service, companion_id="pet", scope_id="owner", workspace_id="repo")
        with self.ctx.db.exclusive() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM memories WHERE type='episodic'").fetchone()[0], 1)

    def test_recent_dialogue_keeps_original_chronology_after_metadata_repair(self):
        older = self.port.observe(self.scope, source_id="earlier-dialogue", revision="1", actor_id="owner",
            content="An earlier greeting.", source_kind="user_statement", conversation_context=True)
        latest = self.port.observe(self.scope, source_id="latest-dialogue", revision="1", actor_id="owner",
            content="Our current topic is the bronze telescope.", source_kind="user_statement", conversation_context=True)
        with self.ctx.db.transaction() as conn:
            conn.execute("UPDATE memories SET created_at='2026-01-01T00:00:00Z', updated_at='2099-01-01T00:00:00Z' WHERE source_ids_json LIKE ?", ('%'+older["observationId"]+'%',))
            conn.execute("UPDATE memories SET created_at='2026-02-01T00:00:00Z', updated_at='2026-02-01T00:00:00Z' WHERE source_ids_json LIKE ?", ('%'+latest["observationId"]+'%',))
        recalled = self.port.recall(self.scope, query="hello", limit=1, include_recent=True)
        self.assertTrue(any("bronze telescope" in part["text"]
            for record in recalled["records"] for part in record.get("conversation", [])))

    def test_batch_graph_validation_reuses_only_the_current_request_walk(self):
        sources = []
        for index in range(18):
            source_id = f"graph-{index}"
            self.port.observe(self.scope, source_id=source_id, revision="1", actor_id="owner",
                content=f"Message {index}", roots=list(sources))
            sources.append({"id": source_id, "revision": "1"})
        with patch.object(self.port, "source", wraps=self.port.source) as read:
            self.assertEqual(self.port.validate(self.scope, sources=sources)["decision"], "eligible")
            self.assertLessEqual(read.call_count, len(sources), "Shared ancestors must not be reread for every source")
        self.port.derivations.record_tombstone(root_source_id="graph-0", reason="withdrawn between streamed chunks")
        self.assertEqual(self.port.validate(self.scope, sources=sources)["decision"], "ineligible")
        self.assertEqual(self.port.validate(self.scope, sources=[{"id": "graph-17"}])["decision"], "unknown")

    def test_small_recall_blocks_read_full_original_and_exclude_current_native_dialogue(self):
        original = "The owner is comparing amber and violet sketches. " * 60 + "Finish with the north-facing window."
        self.port.observe(self.scope, source_id="long-dialogue", content=original, revision="1", actor_id="owner",
                          source_kind="user_statement", conversation_context=True)
        recalled = self.port.context(self.scope, query="sketches", max_chars=6000, include_recent=True, block_chars=128)
        self.assertNotIn(original, recalled["text"])
        self.assertIn("pet_memory_read", recalled["text"])
        memory_id = recalled["records"][0]["memory"]["id"]
        detail = self.port.read(self.scope, memory_id=memory_id)
        self.assertEqual(detail["conversation"][0]["text"], original)
        excluded = self.port.context(self.scope, query="sketches", max_chars=6000, include_recent=True,
                                     exclude_sources=["long-dialogue"], block_chars=128)
        self.assertFalse(excluded["records"])
        args = dict(session_id="summary-session", summary_seq=30, content="The sketches still need comparison.",
                    sources=[{"id":"long-dialogue", "revision":"1"}])
        summary = self.port.summary(self.scope, **args)
        self.assertEqual(self.port.summary(self.scope, **args)["id"], summary["id"])
        self.assertEqual(summary["type"], "episodic")
        self.port.derivations.record_tombstone(root_source_id="long-dialogue", reason="forgotten")
        with self.assertRaises(ConflictError):
            self.port.read(self.scope, memory_id=summary["id"])

    def test_original_context_builder_only_packs_admitted_scope_and_keeps_budget_honest(self):
        self.ctx.service.propose_memory(MemoryProposeIn(type="semantic", content="PRIVATE foreign-only secret"))
        empty = self.port.context(self.scope, query="foreign-only", max_chars=2000)
        self.assertFalse(empty["records"], "An empty admitted list must not trigger unscoped upstream retrieval")
        self.assertNotIn("PRIVATE", empty["text"])
        memory, source = self.memory("own-context", "Owner collects violet shells.")
        context = self.port.context(self.scope, query="violet", max_chars=2000)
        self.assertIn("violet shells", context["text"])
        self.assertIn('"source_roles": ["user_statement"]', context["text"])
        self.assertIn('"updated_at":', context["text"])
        self.assertEqual(context["records"][0]["memory"]["id"], memory["id"])
        self.assertEqual(context["measurement"], "estimated")
        self.assertLessEqual(len(context["text"]), 2000)
        self.port.withdraw(self.scope, memory_id=memory["id"], expected_version=1)
        forgotten = self.port.context(self.scope, query="violet", max_chars=2000, include_recent=True)
        self.assertNotIn("violet shells", forgotten["text"])
        with self.assertRaises(ConflictError):
            self.port.context(self.scope, query="", max_chars=10)

    def test_shared_bank_recent_context_preserves_guest_actor_and_group(self):
        self.port.observe(self.scope, source_id="guest-turn", content="The guest grew a sunflower.", revision="1",
                          actor_id="qq:friend", source_kind="user_statement", conversation_context=True,
                          attribution={"channel": "qq", "accountId": "fixture", "conversationId": "garden-group", "speakerId": "qq:friend"})
        self.port.observe(self.scope, source_id="guest-reply", content="I liked hearing about the sunflower.", revision="1",
                          actor_id="fish", source_kind="agent_inference", conversation_context=True,
                          roots=[{"id": "guest-turn", "revision": "1"}])
        context = self.port.context(self.scope, query="what did the guest grow", include_recent=True, max_chars=24000)
        self.assertIn("sunflower", context["text"])
        self.assertIn("qq:friend", context["text"])
        self.assertIn("garden-group", context["text"])


if __name__ == "__main__":
    unittest.main()
