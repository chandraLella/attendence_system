"""Tiny in-process background job runner with progress, polled by the UI."""
from __future__ import annotations

import logging
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("jobs")
_pool = ThreadPoolExecutor(max_workers=2)
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


class Job:
    def __init__(self, jid: str):
        self.id = jid

    def update(self, **kw):
        with _lock:
            _jobs[self.id].update(kw)


def submit(kind: str, owner: str, fn, *args) -> str:
    jid = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[jid] = {"id": jid, "kind": kind, "owner": owner, "status": "queued",
                      "progress": 0, "total": 0, "message": "Waiting to start", "result": None}

    def run():
        job = Job(jid)
        job.update(status="running", message="Starting")
        try:
            res = fn(job, *args)
            job.update(status="done", result=res, message="Finished")
        except Exception as e:  # noqa: BLE001
            log.error("job %s failed\n%s", jid, traceback.format_exc())
            job.update(status="error", message=str(e))

    _pool.submit(run)
    return jid


def get(jid: str) -> dict | None:
    with _lock:
        j = _jobs.get(jid)
        return dict(j) if j else None
