"""Loopback Mnemosyne host with the scoped Pet port; no parallel collector/runtime."""
import argparse
import json
import os
import sys

import uvicorn
from fastapi import HTTPException, Request
from cognitive_memory.bootstrap import build_context, write_service_json
from cognitive_memory.core.service import ConflictError, NotFoundError
from provider import MemoryPort


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"])
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    scope = json.loads(os.environ["CHATPET_MEMORY_SCOPE"])
    ctx = build_context(data_dir=args.data_dir, token=args.token, host=args.host, port=args.port)
    port = MemoryPort(ctx.service, companion_id=scope["companionId"], scope_id=scope["scopeId"], workspace_id=scope["bankId"])
    operations = {name: getattr(port, name) for name in ("observe", "archive", "summary", "propose", "correct", "withdraw", "recover", "recall", "read", "context", "validate", "materialize")}

    @ctx.app.post("/pet/v1/{operation}")
    async def invoke(operation: str, request: Request):
        import secrets
        if not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {args.token}"):
            raise HTTPException(401, "unauthorized")
        if operation not in operations:
            raise HTTPException(404, "unknown operation")
        try:
            body = await request.json()
            body["scope"] = port.scope_for_request(body["scope"])
            return operations[operation](**body)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
        except NotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except (ValueError, TypeError, KeyError) as exc:
            raise HTTPException(422, str(exc)) from exc

    server = uvicorn.Server(uvicorn.Config(ctx.app, host=args.host, port=args.port, access_log=False, log_level="warning"))
    startup = server.startup

    async def ready(*a, **kw):
        await startup(*a, **kw)
        bound = server.servers[0].sockets[0].getsockname()[1]
        write_service_json(ctx, bound)
        print(f"DSH_MEMORY_BOUND {args.host}:{bound}", flush=True)

    server.startup = ready
    try:
        ctx.runtime.start()
        server.run()
    finally:
        ctx.runtime.stop()
        ctx.db.close()


if __name__ == "__main__":
    main()
