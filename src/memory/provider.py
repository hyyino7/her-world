"""Pet scope/decision adapter over the one Mnemosyne service and its SQLite Bank.

No independent source-version, tombstone, retriever or extraction store lives here.
The native consumer must use this port rather than the privileged upstream API.
"""
from __future__ import annotations

import json
import hashlib
from typing import Any

from cognitive_memory.core.service import ConflictError, NotFoundError
from cognitive_memory.domain.models import ContextBuildIn, Memory, MemoryProposeIn, MemoryUpdateIn, MemoryType, ObservationIn, SearchQuery
from cognitive_memory.domain.spatiotemporal import is_temporally_expired
from cognitive_memory.retrieval.pipeline import run_retrieve
from cognitive_memory.evidence.derivation import DerivationStore
from cognitive_memory.governance.workspace import grant_workspace_read


class MemoryPort:
    def __init__(self, service, *, companion_id: str, scope_id: str, workspace_id: str, clock=None):
        if not all((companion_id, scope_id, workspace_id)):
            raise ValueError("explicit Memory scope required")
        self.service = service
        self.clock = clock
        self._wire_scope = dict(companionId=companion_id, scopeId=scope_id, bankId=workspace_id)
        # Keep the persisted metadata and evidence keys readable by 0.5.0.
        self.scope = dict(companionId=companion_id, scopeId=scope_id, workspaceId=workspace_id)
        self.derivations = DerivationStore(service.db)
        grant_workspace_read(service.db, workspace_id)
        # Reuse the provider's existing transactional write-guard seam for both
        # immediate and background consolidation. No second processor/queue.
        service._pet_context_guard = self.context_write_guard
        if not getattr(service, "_pet_context_guard_installed", False):
            original = service.propose_memory
            def guarded(body, *, write_guard=None):
                def check_write():
                    if write_guard:
                        write_guard()
                    service._pet_context_guard(body)
                return original(body, write_guard=check_write)
            service.propose_memory = guarded
            service._pet_context_guard_installed = True
        # Existing admitted user observations predate user-dialogue projection.
        # Repair only those records in this exact provider scope, never native
        # raw logs or withdrawn sources. The original consolidation key and
        # memory update/version operations retain one authority and identity.
        with service.db.exclusive() as conn:
            previous = conn.execute("SELECT id, source_kind, metadata_json FROM observations WHERE source_kind IN ('user_statement','system')").fetchall()
        for row in previous:
            if json.loads(row["metadata_json"]).get("pet_scope") != self.scope:
                continue
            try:
                if row["source_kind"] == "user_statement":
                    self.consolidate_context(row["id"])
                else:
                    self.repair_interaction(row["id"])
            except ConflictError:
                # Rejected/withdrawn source stays withheld, not reconstructed.
                continue

    def context_write_guard(self, body) -> None:
        meta = body.metadata
        if meta.get("pet_context") or meta.get("pet_interaction"):
            self.authorize(meta.get("pet_scope"))
            if not meta.get("pet_sources") or self.validate(self.scope, sources=meta["pet_sources"])["decision"] != "eligible":
                raise ConflictError("completed-conversation source is no longer eligible")

    @staticmethod
    def interaction_source(source_id: str, kind: str, meta: dict) -> bool:
        """Only an admitted domain fact is an experience; alarms and transport
        envelopes remain system evidence, never owner statements."""
        attribution = meta.get("attribution", {})
        if not isinstance(attribution, dict):
            return False
        domain, fact_id = attribution.get("domain"), attribution.get("factId")
        return (kind == "system" and source_id.startswith("native-fact:")
                and domain in ("body", "economy") and isinstance(fact_id, str)
                and fact_id.startswith(domain + ":")
                and attribution.get("kind") in ("owner", "companion", "system"))

    def interaction_envelope(self, source_id: str, kind: str, meta: dict) -> bool:
        roots = meta.get("pet_roots", [])
        return (kind == "system" and source_id.startswith("native-input:") and bool(roots)
                and all((source := self.source(dep["id"]))
                        and source["metadata"].get("pet_scope") == self.scope
                        and self.interaction_source(dep["id"], source["kind"], source["metadata"])
                        for dep in roots))

    def repair_interaction(self, observation_id: str) -> str | None:
        """Project an already admitted fact using its original episode/key.
        Preserve content, observations, withdrawn records and prior versions.
        Also retain legacy transport evidence without consolidating it again."""
        from cognitive_memory.cognition.consolidate import consolidate_observation
        with self.service.db.transaction():
            row = self.service.db.connect().execute("SELECT * FROM observations WHERE id=?", (observation_id,)).fetchone()
            if row is None:
                raise NotFoundError("interaction observation missing")
            meta = json.loads(row["metadata_json"])
            self.authorize(meta.get("pet_scope"))
            ref = meta.get("source_ref", {})
            if not isinstance(ref, dict) or not isinstance(ref.get("source_id"), str) or not ref.get("revision"):
                return None
            if self.interaction_envelope(ref["source_id"], row["source_kind"], meta):
                if not meta.get("pet_evidence_only"):
                    self.service.db.connect().execute("UPDATE observations SET metadata_json=? WHERE id=?",
                        (json.dumps({**meta, "pet_evidence_only": True}), observation_id))
                return None
            if not self.interaction_source(ref["source_id"], row["source_kind"], meta):
                return None
            dependencies = [{"id": ref["source_id"], "revision": ref["revision"]}]
            if self.validate(self.scope, sources=dependencies)["decision"] != "eligible":
                return None
            attribution = {"pet_scope": self.scope, "pet_sources": dependencies, "pet_interaction": True}
            # The source stays system evidence. This metadata only supplies its
            # scoped experience projection to the existing consolidation path.
            if any(meta.get(key) != value for key, value in attribution.items()):
                self.service.db.connect().execute("UPDATE observations SET metadata_json=? WHERE id=?",
                    (json.dumps({**meta, **attribution}), observation_id))
            memory_id = consolidate_observation(self.service, observation_id)
            memory = self.service.get_memory(memory_id)
            if memory["status"] in ("active", "candidate") and not self.service.withdrawal_status(memory_id=memory_id) \
                    and any(memory["metadata"].get(key) != value for key, value in attribution.items()):
                self.service.update_memory(memory_id, MemoryUpdateIn(expected_version=memory["version"],
                    metadata={**memory["metadata"], **attribution}))
            return memory_id

    def consolidate_context(self, observation_id: str) -> str:
        from cognitive_memory.cognition.consolidate import consolidate_observation
        with self.service.db.transaction():
            row = self.service.db.connect().execute("SELECT * FROM observations WHERE id=?", (observation_id,)).fetchone()
            if row is None:
                raise NotFoundError("conversation observation missing")
            meta = json.loads(row["metadata_json"])
            self.authorize(meta.get("pet_scope"))
            ref = meta["source_ref"]
            dependencies = [{"id": ref["source_id"], "revision": ref["revision"]}]
            if row["source_kind"] not in ("user_statement", "agent_inference") or self.validate(self.scope, sources=dependencies)["decision"] != "eligible":
                raise ConflictError("conversation source unavailable")
            memory_id = consolidate_observation(self.service, observation_id)
            # Repair the existing rule episode's attribution in place, including
            # already admitted user observations from earlier adapter versions.
            # No raw-log backfill, new semantic claim or second record store.
            memory = self.service.get_memory(memory_id)
            attribution = {"pet_scope": self.scope, "pet_sources": dependencies, "pet_context": True}
            if any(memory["metadata"].get(key) != value for key, value in attribution.items()):
                self.service.update_memory(memory_id, MemoryUpdateIn(
                    expected_version=memory["version"], metadata={**memory["metadata"], **attribution}))
            return memory_id

    def archive(self, scope: dict, *, session_id: str, sources: list[str]) -> dict:
        """Consolidate persisted, admitted dialogue using the native checkpoint ledger."""
        from cognitive_memory.cognition.session_checkpoint import SessionLedger
        self.authorize(scope)
        if not session_id:
            raise ValueError("archive requires a native session")
        bank_id = self.scope["workspaceId"]
        ledger = SessionLedger(self.service.db)
        with self.service.db.transaction():
            records = []
            for source_id in dict.fromkeys(sources):
                source = self.source(source_id)
                if not source or source["metadata"].get("pet_scope") != scope:
                    raise ConflictError("archive source unavailable in this workspace")
                if source["kind"] not in ("user_statement", "agent_inference"):
                    raise ValueError("archive accepts dialogue only")
                if self.source_decision(source_id) == "eligible":
                    records.append({"id": self.consolidate_context(source["id"])})
            # Keep references. Retrieval checks the current record and its sources;
            # a correction/forget cannot leave an independent archive text to replay.
            result = ledger.save_checkpoint(session_id=session_id, bank_id=bank_id,
                checkpoint_id=f"pet-archive:{session_id}", principal_banks=[bank_id],
                evidence_revisions=records, metadata={"pet_scope": scope, "native_archive": True})
            if not result.get("ok"):
                raise ConflictError("could not save the workspace archive checkpoint")
            return {"checkpoint_id": result["checkpoint_id"], "records": len(records)}

    def latest_archive(self, limit: int) -> list[dict]:
        with self.service.db.exclusive() as conn:
            row = conn.execute("""SELECT manifest_json FROM session_checkpoints
                WHERE bank_id=? AND json_extract(manifest_json,'$.metadata.native_archive')=1
                AND json_extract(manifest_json,'$.metadata.pet_scope.companionId')=?
                AND json_extract(manifest_json,'$.metadata.pet_scope.scopeId')=?
                ORDER BY updated_at DESC, rowid DESC LIMIT 1""",
                (self.scope["workspaceId"], self.scope["companionId"], self.scope["scopeId"])).fetchone()
        if not row:
            return []
        return list(reversed(json.loads(row["manifest_json"])["evidence_revisions"][-limit:]))

    def scope_for_request(self, scope: dict) -> dict:
        if scope != self._wire_scope:
            raise PermissionError("Memory scope mismatch")
        return self.scope

    def authorize(self, scope: dict) -> None:
        if scope != self.scope:
            raise PermissionError("Memory scope mismatch")

    def source(self, source_id: str) -> dict | None:
        with self.service.db.exclusive() as conn:
            # Capture already owns the durable source-key -> observation mapping.
            # Resolve its ID, then read current metadata rather than the cached
            # capture response (which predates corrections/withdrawal changes).
            captured = self.service._idempotent_get(conn, f"pet:observation:{source_id}", "observation")
            if not captured:
                return None
            row = conn.execute("SELECT * FROM observations WHERE id=?", (captured["id"],)).fetchone()
        if row is None:
            return None
        metadata = json.loads(row["metadata_json"])
        ref = metadata.get("source_ref", {})
        if ref.get("source_id") != source_id:
            return None
        return dict(id=row["id"], content=row["content"], metadata=metadata, ref=ref, kind=row["source_kind"],
                    recorded_at=row["created_at"], occurred_at=row["occurred_at"])

    def excerpts_of(self, source_id: str) -> list[dict]:
        with self.service.db.exclusive() as conn:
            rows = conn.execute("SELECT metadata_json FROM observations WHERE json_extract(metadata_json, '$.pet_excerpt_parent.id')=?",
                                (source_id,)).fetchall()
        return [json.loads(row["metadata_json"]) for row in rows]

    def source_decision(self, source_id: str, revision: str | None = None, seen: frozenset = frozenset(), memo: dict | None = None, container: bool = False) -> str:
        memo = {} if memo is None else memo
        key = (source_id, revision, container)
        if key in memo:
            return memo[key]
        if key in seen or len(seen) >= 2048:
            return "unknown"
        source = self.source(source_id)
        if not source:
            return "unknown"
        if source["metadata"].get("pet_scope") != self.scope:
            return "unknown"
        ref = source["ref"]
        if source["metadata"].get("pet_superseded_by"):
            return "ineligible"
        actual = str(ref.get("revision") or "")
        expected = str(revision) if revision is not None else actual
        if not self.derivations.recheck_revisions([{"id": source_id, "revision": expected}],
                current_revisions={source_id: actual})["chosen_allowed"]:
            return "unknown"
        if self.service.withdrawal_status(source_id=source_id):
            return "ineligible"
        if self.derivations.is_tombstoned(root_source_id=ref["root_source_id"]).get("tombstoned"):
            return "ineligible"
        parent = source["metadata"].get("pet_excerpt_parent")
        if parent:
            decision = self.source_decision(parent["id"], parent["revision"], seen | {key}, memo, container=True)
            if decision != "eligible":
                return decision
        parents = [self.source_decision(dep["id"], dep["revision"], seen | {key}, memo) if dep.get("revision") else "unknown"
                   for dep in source["metadata"].get("pet_roots", [])]
        if "ineligible" in parents:
            return "ineligible"
        if "unknown" in parents:
            return "unknown"
        if not container and not parent:
            # A raw message containing a revoked excerpt cannot be re-injected.
            # Other independently evidenced excerpts remain usable through the
            # same provider, without treating the whole raw message as eligible.
            children = [self.source_decision(meta["source_ref"]["source_id"], meta["source_ref"]["revision"], seen | {key}, memo, container=True)
                        for meta in self.excerpts_of(source_id)]
            if "ineligible" in children:
                return "ineligible"
            if "unknown" in children:
                return "unknown"
        memo[key] = "eligible"
        return memo[key]

    def observe(self, scope: dict, *, source_id: str, content: str, revision: str,
                actor_id: str, source_kind: str = "user_statement", roots: list[dict] | None = None, excerpt_parent: dict | None = None,
                conversation_context: bool = False, attribution: dict | None = None, occurred_at: str | None = None) -> dict:
        self.authorize(scope)
        if not all((source_id, revision, actor_id)):
            raise ValueError("attributed source/revision required")
        if conversation_context and (source_kind not in ("agent_inference", "user_statement") or source_kind == "agent_inference" and not roots):
            raise ValueError("completed context requires actual attributed execution sources")
        previous = self.source(source_id)
        if previous:
            if previous["content"] != content or str(previous["ref"]["revision"]) != str(revision) or previous["metadata"].get("pet_roots", []) != (roots or []) or previous["metadata"].get("pet_excerpt_parent") != excerpt_parent:
                raise ConflictError("source replay payload changed")
            decision = self.source_decision(source_id)
            if conversation_context and decision == "eligible":
                self.consolidate_context(previous["id"])
            elif source_kind == "system":
                self.repair_interaction(previous["id"])
            return dict(sourceId=source_id, observationId=previous["id"], state="duplicate", decision=decision)
        if self.derivations.is_tombstoned(root_source_id=source_id).get("tombstoned"):
            return dict(sourceId=source_id, observationId=None, state="blocked", decision="ineligible")
        metadata = {"workspace_id": scope["workspaceId"], "pet_scope": scope, "actor_id": actor_id,
                    "agent_id": scope["companionId"], "pet_roots": roots or [],
                    "pet_excerpt_parent": excerpt_parent, "attribution": attribution or {},
                    **({"pet_context": True, "pet_sources": [{"id": source_id, "revision": revision}]} if conversation_context else {}),
                    "source_ref": {"source_id": source_id, "root_source_id": source_id, "revision": revision}}
        if self.interaction_source(source_id, source_kind, metadata):
            metadata.update(pet_interaction=True, pet_sources=[{"id": source_id, "revision": revision}])
        elif self.interaction_envelope(source_id, source_kind, metadata):
            # Classify before the capture transaction publishes its event. A
            # background worker may consolidate immediately after that commit.
            metadata["pet_evidence_only"] = True
        observation = self.service.capture_observation(ObservationIn(
            source_kind=source_kind, content=content, occurred_at=occurred_at, producer="dsh", subject_id=scope["scopeId"],
            agent_id=scope["companionId"], idempotency_key=f"pet:observation:{source_id}",
            metadata=metadata))
        decision = self.source_decision(source_id)
        if conversation_context and decision == "eligible":
            self.consolidate_context(observation.id)
        elif source_kind == "system":
            self.repair_interaction(observation.id)
        return dict(sourceId=source_id, observationId=observation.id, state="recorded", decision=decision)

    def evidence_excerpts(self, scope: dict, sources: list[dict], quotes: list[str] | None) -> list[dict]:
        """Model chooses meaning/quotes; deterministic code only checks attribution.

        Excerpts are ordinary upstream observations and use its existing source
        revisions/tombstones. No second claim, version or eligibility store.
        """
        selected = []
        matched = set()
        for dep in sources:
            source = self.source(dep["id"])
            if not source or not dep.get("revision"):
                raise ConflictError("missing source/revision")
            if source["metadata"].get("pet_excerpt_parent"):
                if self.source_decision(dep["id"], dep["revision"]) != "eligible":
                    raise ConflictError("source excerpt unavailable")
                selected.append(dep)
                continue
            if self.source_decision(dep["id"], dep["revision"], container=True) != "eligible":
                raise ConflictError("source container unavailable")
            for quote in quotes if quotes is not None else [source["content"]]:
                if not isinstance(quote, str) or not quote:
                    raise ValueError("non-empty exact evidence quote required")
                start = source["content"].find(quote)
                if start < 0:
                    continue
                end = start + len(quote)
                for child in self.excerpts_of(dep["id"]):
                    span = child["pet_excerpt_parent"]
                    ref = child["source_ref"]
                    if start < span["end"] and span["start"] < end and self.source_decision(ref["source_id"], ref["revision"], container=True) != "eligible":
                        raise ConflictError("evidence quote overlaps superseded/withdrawn material")
                key = hashlib.sha256(json.dumps([self.scope, dep, start, end, quote], sort_keys=True).encode()).hexdigest()
                source_id = f"excerpt:{key}"
                self.observe(scope, source_id=source_id, content=quote, revision=dep["revision"],
                    actor_id=source["metadata"]["actor_id"], source_kind=source["kind"],
                    excerpt_parent=dict(dep, start=start, end=end))
                selected.append({"id": source_id, "revision": dep["revision"]})
                matched.add(quote)
        if not selected or quotes is not None and matched != set(quotes):
            raise ConflictError("evidence quotes must occur in the admitted sources")
        return list({(dep["id"], dep["revision"]): dep for dep in selected}.values())

    def materialize(self, scope: dict, *, sources: list[dict]) -> list[dict]:
        self.authorize(scope)
        result = []
        for dep in sources:
            source = self.source(dep["id"])
            if not source or not (source["metadata"].get("pet_excerpt_parent") or source["kind"] in ("user_statement", "agent_inference")
                    or self.interaction_source(dep["id"], source["kind"], source["metadata"])) or self.source_decision(dep["id"], dep.get("revision")) != "eligible":
                raise ConflictError("provider source material is unavailable")
            result.append(dict(sourceId=dep["id"], revision=dep["revision"], observationId=source["id"],
                               text=source["content"], actorId=source["metadata"]["actor_id"]))
        return result

    def validate(self, scope: dict, *, sources: list[dict], memories: list[dict] | None = None) -> dict:
        # One existing provider lock/snapshot and one graph walk per request.
        # The memo never survives a request, so correction/withdrawal is checked
        # afresh even for consecutive streamed chunks. No TTL or second authority.
        with self.service.db.exclusive():
            return self._validate(scope, sources, memories, {})

    def _validate(self, scope: dict, sources: list[dict], memories: list[dict] | None, memo: dict) -> dict:
        self.authorize(scope)
        decisions = [self.source_decision(dep["id"], dep.get("revision"), memo=memo)
                     if dep.get("revision") else "unknown" for dep in sources]
        for dep in memories or []:
            try:
                memory = self.service.get_memory(dep["id"])
                if not dep.get("revision") or not self.derivations.recheck_revisions([dep],
                        current_revisions={dep["id"]: str(memory["version"])})["chosen_allowed"]:
                    decisions.append("unknown")
                elif memory["status"] not in ("active", "candidate") or self.service.withdrawal_status(memory_id=dep["id"]):
                    decisions.append("ineligible")
                elif is_temporally_expired(memory.get("metadata", {}), expires_at=memory.get("expires_at"), now=self.clock() if self.clock else None):
                    decisions.append("ineligible")
                else:
                    dependencies = memory.get("metadata", {}).get("pet_sources", [])
                    decisions.append(self._validate(scope, dependencies, None, memo)["decision"] if dependencies else "unknown")
            except Exception:
                decisions.append("unknown")
        return {"decision": "ineligible" if "ineligible" in decisions else "unknown" if "unknown" in decisions else "eligible"}

    def propose(self, scope: dict, *, operation_id: str, content: str, sources: list[dict], evidence_quotes: list[str] | None = None) -> dict:
        self.authorize(scope)
        # Guard and provider write share its transaction, closing delayed extraction races.
        with self.service.db.transaction():
            sources = self.evidence_excerpts(scope, sources, evidence_quotes)
            def guard():
                if not sources or self.validate(scope, sources=sources)["decision"] != "eligible":
                    raise ConflictError("source is unavailable, revised or withdrawn")
            guard()
            prior = self.service._idempotent_get(self.service.db.connect(), f"pet:memory:{operation_id}", "memory_propose")
            if prior and (prior["content"] != content or prior.get("metadata", {}).get("pet_sources") != sources):
                raise ConflictError("memory proposal replay payload changed")
            observations = [self.source(dep["id"])["id"] for dep in sources]
            memory = self.service.propose_memory(MemoryProposeIn(
                content=content, source_ids=observations, status="active", idempotency_key=f"pet:memory:{operation_id}",
                metadata={"pet_scope": scope, "pet_sources": sources,
                          "source_ref": {"root_source_id": sources[0]["id"]}}), write_guard=guard)
            return memory.model_dump(mode="json")

    def correct(self, scope: dict, *, memory_id: str, expected_version: int,
                content: str, sources: list[dict], evidence_quotes: list[str] | None = None) -> dict:
        self.authorize(scope)
        with self.service.db.transaction():
            sources = self.evidence_excerpts(scope, sources, evidence_quotes)
            old = self.service.get_memory(memory_id)
            if old.get("metadata", {}).get("pet_scope") != scope:
                raise PermissionError("foreign memory")
            if old["status"] != "active" or self.service.withdrawal_status(memory_id=memory_id):
                raise ConflictError("withdrawn or unfinished memory cannot be corrected")
            if not sources or self.validate(scope, sources=sources)["decision"] != "eligible":
                raise ConflictError("correction requires eligible attributable sources")
            # Preserve upstream versions/history; a correction is not a second Bank.
            previous = old["metadata"].get("pet_sources", [])
            meta = dict(old["metadata"], pet_sources=sources,
                        pet_previous_sources=old["metadata"].get("pet_previous_sources", []) + previous,
                        source_ref={"root_source_id": sources[0]["id"]})
            updated = self.service.update_memory(memory_id, MemoryUpdateIn(content=content,
                expected_version=expected_version, metadata=meta)).model_dump(mode="json")
            # Retain raw observation bytes; supersession resides in the provider's
            # own source metadata, so old queued extraction cannot publish later.
            for dep in previous:
                if dep in sources:
                    continue
                source = self.source(dep["id"])
                metadata = dict(source["metadata"], pet_superseded_by=sources)
                self.service.db.connect().execute("UPDATE observations SET metadata_json=? WHERE id=?",
                    (json.dumps(metadata), source["id"]))
                self.derivations.mark_stale_for_source(dep["id"], new_revision=f"corrected:{sources[0]['id']}")
            return updated

    def withdraw(self, scope: dict, *, memory_id: str, expected_version: int) -> dict:
        self.authorize(scope)
        with self.service.db.transaction():
            memory = self.service.get_memory(memory_id)
            if memory.get("metadata", {}).get("pet_scope") != scope:
                raise PermissionError("foreign memory")
            pending = self.service.withdrawal_status(memory_id=memory_id)
            if not pending and memory["version"] != expected_version:
                raise ConflictError("withdrawal version conflict")
            return self.service.forget_memory(memory_id)

    def recover(self, scope: dict) -> list[dict]:
        self.authorize(scope)
        return [self.service.forget_memory(op["memory_id"], hard=op["hard"])
                for op in self.service.withdrawal_status()
                if self.service.get_memory(op["memory_id"]).get("metadata", {}).get("pet_scope") == scope]

    def recall(self, scope: dict, *, query: str, limit: int = 8, include_recent: bool = False, exclude_sources: list[str] | None = None, exclude_memories: list[str] | None = None) -> dict:
        self.authorize(scope)
        records = []
        # Existing upstream search supplies ranking/tokenization; filter at this
        # single decision boundary, never invent another retrieval implementation.
        metadata_scope = {f"pet_scope.{key}": value for key, value in self.scope.items()}
        selections = [(MemoryType.EPISODIC, {**metadata_scope, "pet_summary": True}),
            (MemoryType.SEMANTIC, metadata_scope),
            (MemoryType.EPISODIC, {**metadata_scope, "pet_context": True, "source_kind": "user_statement"}),
            (MemoryType.EPISODIC, {**metadata_scope, "pet_context": True, "source_kind": "agent_inference"}),
            (MemoryType.EPISODIC, {**metadata_scope, "pet_interaction": True, "source_kind": "system"})]
        channels = [run_retrieve(self.service, query=query, force=True, types=[memory_type],
            metadata_match=metadata, limit=min(50, max(1, limit))).get("items", [])
            for memory_type, metadata in selections]
        if include_recent and query.strip():
            # Recent dialogue is a chronological window, not another relevance
            # query. Reuse the provider's native search directly, keeping the
            # original pipeline for topic/fact retrieval. Metadata repair must
            # not turn an old message into the newest conversational event.
            recent = [[{"id": memory.id} for memory in self.service.search(SearchQuery(
                query="", types=[memory_type], metadata_match=metadata,
                limit=min(50, max(1, limit)), order_by="created_at",
                mode="any", spatiotemporal_rerank=False))]
                for memory_type, metadata in selections]
            channels = [recent[4], recent[0], self.latest_archive(limit), recent[2], recent[3], *channels, recent[1]]
        # A full fact channel must not consume every slot before conversation
        # context is considered. Alternate the existing provider result channels.
        from itertools import zip_longest
        seen = set()
        for item in (item for group in zip_longest(*channels) for item in group if item is not None):
            if item["id"] in seen or item["id"] in (exclude_memories or []):
                continue
            seen.add(item["id"])
            memory = Memory.model_validate(self.service.get_memory(item["id"]))
            meta = memory.metadata
            sources = meta.get("pet_sources", [])
            def already_visible(dep):
                source = self.source(dep["id"])
                parent = source["metadata"].get("pet_excerpt_parent") if source else None
                return (parent["id"] if parent else dep["id"]) in (exclude_sources or [])
            if exclude_sources and sources and all(already_visible(dep) for dep in sources):
                continue
            if meta.get("pet_scope") != scope or not sources:
                continue
            dependencies = {"sources": sources, "memories": [{"id": memory.id, "revision": str(memory.version)}]}
            if self.validate(scope, **dependencies)["decision"] == "eligible":
                record = {"memory": memory.model_dump(mode="json"), "dependencies": dependencies}
                if meta.get("pet_context"):
                    # The provider's rule summary is lossy. Return the exact
                    # eligible dialogue separately, never relabel it as
                    # an extracted fact or a semantic summary.
                    record["conversation"] = [{"sourceId": dep["id"], "role": "user" if source["kind"] == "user_statement" else "assistant",
                        "recorded_at": source["recorded_at"], "text": source["content"],
                        "actor_id": source["metadata"].get("actor_id"), "attribution": source["metadata"].get("attribution", {})}
                        for dep in sources if (source := self.source(dep["id"]))
                        and source["kind"] in ("user_statement", "agent_inference")]
                if meta.get("pet_interaction"):
                    record["interactions"] = [{"sourceId": dep["id"], "role": "system",
                        "recorded_at": source["recorded_at"], "occurred_at": source["occurred_at"],
                        "text": source["content"], "actor_id": source["metadata"].get("actor_id"),
                        "attribution": source["metadata"].get("attribution", {})}
                        for dep in sources if (source := self.source(dep["id"]))
                        and self.interaction_source(dep["id"], source["kind"], source["metadata"])]
                records.append(record)
                if len(records) >= max(1, limit):
                    break
        return dict(records=records, coverage="partial" if records else "unknown")

    def summary(self, scope: dict, *, session_id: str, summary_seq: int, content: str, sources: list[dict]) -> dict:
        self.authorize(scope)
        if not content.strip() or not sources:
            raise ValueError("summary requires native content and attributable sources")
        def guard():
            if self.validate(scope, sources=sources)["decision"] != "eligible":
                raise ConflictError("summary sources unavailable")
        with self.service.db.transaction():
            guard()
            memory = self.service.propose_memory(MemoryProposeIn(type=MemoryType.EPISODIC,
                content=content, bank_id=scope["workspaceId"], status="active",
                source_ids=[self.source(dep["id"])["id"] for dep in sources],
                idempotency_key=f"pet:summary:{session_id}:{summary_seq}",
                metadata={"pet_scope": scope, "pet_sources": sources, "pet_summary": True,
                          "native_session": session_id, "summary_seq": summary_seq}), write_guard=guard)
            return memory.model_dump(mode="json")

    def read(self, scope: dict, *, memory_id: str) -> dict:
        self.authorize(scope)
        memory = self.service.get_memory(memory_id)
        sources = memory.get("metadata", {}).get("pet_sources", [])
        if memory.get("metadata", {}).get("pet_scope") != scope or not sources:
            raise PermissionError("foreign memory")
        dependencies = {"sources": sources, "memories": [{"id": memory_id, "revision": str(memory["version"])}]}
        if self.validate(scope, **dependencies)["decision"] != "eligible":
            raise ConflictError("memory detail unavailable")
        return {"memory": memory, "dependencies": dependencies,
                "conversation": [{"sourceId": dep["id"], "text": source["content"], "role": source["kind"],
                                 "actor_id": source["metadata"].get("actor_id"), "attribution": source["metadata"].get("attribution", {})}
                                 for dep in sources if (source := self.source(dep["id"]))]}

    def context(self, scope: dict, *, query: str, max_chars: int, limit: int = 8, include_recent: bool = False, exclude_sources: list[str] | None = None, exclude_memories: list[str] | None = None, block_chars: int = 600) -> dict:
        self.authorize(scope)
        if type(max_chars) is not int or max_chars < 2:
            raise ValueError("positive context character allowance required")
        recalled = self.recall(scope, query=query, limit=limit, include_recent=include_recent, exclude_sources=exclude_sources, exclude_memories=exclude_memories)
        records = {record["memory"]["id"]: record for record in recalled["records"]}
        if type(block_chars) is not int or not 128 <= block_chars <= 4000:
            raise ValueError("invalid recall block size")
        views = {}
        for record in recalled["records"]:
            memory = record["memory"]
            view = {"memory": {key: memory[key] for key in ("id", "version", "content", "type", "status", "updated_at")},
                    "epistemic": memory.get("metadata", {}).get("epistemic", "unverified_record"),
                    "source_roles": sorted({source["kind"]
                        for dep in record["dependencies"]["sources"] if (source := self.source(dep["id"]))})}
            view["speakers"] = [{"actor_id": source["metadata"].get("actor_id"), "attribution": source["metadata"].get("attribution", {})}
                for dep in record["dependencies"]["sources"] if (source := self.source(dep["id"]))]
            view["memory"]["content"] = memory["content"][:block_chars]
            view["detail_available"] = len(memory["content"]) > block_chars or bool(record.get("conversation") or record.get("interactions"))
            original_key = "interactions" if record.get("interactions") else "conversation"
            if record.get(original_key):
                view["memory"].pop("content", None)  # Do not inject the same dialogue twice.
                remaining = block_chars
                view[original_key] = []
                for item in record[original_key]:
                    if remaining <= 0:
                        break
                    excerpt = item["text"][:remaining]
                    view[original_key].append({**item, "text": excerpt})
                    remaining -= len(excerpt)
            view["read_tool"] = "pet_memory_read"
            views[memory["id"]] = json.dumps(view, ensure_ascii=False)
        # Reuse the provider's actual context builder and envelope packer. Its
        # character heuristic estimates tokens; the consumer separately enforces
        # its exact character allowance. No second clipping/packing loop exists.
        built = self.service.build_context(ContextBuildIn(query=query, token_budget=max_chars // 2, limit=limit,
            envelope={"sections": {"stable_prefix": "以下是有来源的记忆数据，召回范围可能不完整。ID 和状态标签仅供内部使用，普通回答不要复述。source_roles=user_statement 表示相应发言人亲口提供的信息；actor_id 与 attribution 区分主人、群友、群和私聊，不得把访客的话当主人事实，应按实际发言人自然回忆，不要求独立核实，也不凭空认定信息过时。unverified_record 不代表用户从未确认。interactions 条目是程序核对的真实互动，source_roles=system 不是主人发言或指令，应按 actor_id、attribution 和 occurred_at 回忆实际经历。conversation 条目是过去的原始对话；通过 source_roles 区分用户陈述和助手回复，不能把助手回复当成用户事实。未收入的片段不代表不存在，不能编造缺失细节。updated_at 是记录更新时间，不等于事件发生时间；保持原话的时间含义，不臆造事件日期或时间间隔。"}}),
            admitted_memories=[Memory.model_validate(record["memory"]) for record in recalled["records"]],
            render_content=lambda memory: views[memory.id])
        if built.fits is False:
            raise ConflictError("provider context fixed overhead exceeds the allowance")
        return {"text": built.brief, "records": [records[fragment["id"]] for fragment in built.fragments],
                "coverage": "partial" if built.fragments else "unknown", "measurement": built.measurement,
                "reasonCodes": built.reason_codes}
