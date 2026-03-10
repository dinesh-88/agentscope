#!/usr/bin/env python3
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = os.getenv("API_BASE", "http://localhost:8080")


def main() -> None:
    payload_path = Path(__file__).with_name("sample_trace.json")
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    request_body = json.dumps(payload).encode("utf-8")

    try:
        request = urllib.request.Request(
            f"{API_BASE}/v1/ingest",
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
            print(f"Status: {response.status}")
            if body:
                print(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        print(f"Status: {exc.code}")
        print(body)
        raise


if __name__ == "__main__":
    main()
