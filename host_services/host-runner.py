#!/usr/bin/env python3

# /usr/local/bin/host-runner.py
import os, uuid, subprocess, shlex, time, codecs, threading
from flask import Flask, request, jsonify, abort
from concurrent.futures import ThreadPoolExecutor, TimeoutError

PORT = int(os.environ.get("HOST_RUNNER_PORT", "9000"))
AUTH_TOKEN = os.environ.get("HOST_RUNNER_TOKEN", "")

app = Flask(__name__)
executor = ThreadPoolExecutor(max_workers=4)
jobs = {}  # job_id -> {"status": "queued|running|succeeded|failed",
           #           "returncode": int|None, "stdout": str, "stderr": str, "started_at": float, "ended_at": float}

def run_job(job_id, script, args):
      job = jobs[job_id]
      job.update({"status": "running", "started_at": time.time()})

      def capture(stream, field):
          decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
          try:
              # Read available bytes without waiting for a newline or completion.
              while True:
                  chunk = stream.read1(4096)
                  if not chunk:
                      break
                  job[field] += decoder.decode(chunk)
              job[field] += decoder.decode(b"", final=True)
          finally:
              stream.close()

      try:
          if script != "/opt/hooks/on-system-created.sh":
              raise RuntimeError("Script path not allowed")

          env = os.environ.copy()
          env["PYTHONUNBUFFERED"] = "1"

          proc = subprocess.Popen(
              [script, *args],
              stdout=subprocess.PIPE,
              stderr=subprocess.PIPE,
              env=env,
          )

          readers = [
              threading.Thread(
                  target=capture, args=(proc.stdout, "stdout"), daemon=True
              ),
              threading.Thread(
                  target=capture, args=(proc.stderr, "stderr"), daemon=True
              ),
          ]

          for reader in readers:
              reader.start()

          returncode = proc.wait()

          # Collect remaining output before marking the job finished.
          for reader in readers:
              reader.join()

          job.update({
              "status": "succeeded" if returncode == 0 else "failed",
              "returncode": returncode,
              "ended_at": time.time(),
          })

      except Exception as error:
          job["stderr"] += f"\nRunner error: {error}\n"
          job.update({
              "status": "failed",
              "returncode": -1,
              "ended_at": time.time(),
          })

def require_auth(req):
    token = req.headers.get("X-Auth-Token", "")
    if not AUTH_TOKEN or token != AUTH_TOKEN:
        abort(401, description="Unauthorized")

@app.post("/")
def submit():
    require_auth(request)
    data = request.get_json(force=True, silent=True) or {}
    script = data.get("script")
    args = data.get("args") or []
    wait_mode = (data.get("wait") or "").lower()   # "", "ack", "done"
    timeout = float(data.get("timeout", 0))        # seconds

    if not script:
        abort(400, description="Missing 'script'")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "returncode": None,
                    "stdout": "", "stderr": "", "started_at": None, "ended_at": None}

    future = executor.submit(run_job, job_id, script, args)

    # Default / "ack": return immediately with job id
    if wait_mode in ("", "ack"):
        return jsonify({"job_id": job_id, "status": "queued"}), 202

    # wait_mode == "done": block up to timeout
    if wait_mode == "done":
        try:
            if timeout and timeout > 0:
                future.result(timeout=timeout)
            else:
                future.result()  # not recommended; would block fully
        except TimeoutError:
            # Still running
            return jsonify({"job_id": job_id, "status": jobs[job_id]["status"]}), 200
        # Finished
        return jsonify({"job_id": job_id, **jobs[job_id]}), 200

    return jsonify({"error": "Invalid wait mode"}), 400

@app.get("/jobs/<job_id>")
def job_status(job_id):
    require_auth(request)
    if job_id not in jobs:
        abort(404, description="Unknown job")
    return jsonify({"job_id": job_id, **jobs[job_id]}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
