#!/usr/bin/env python3
import json
import os
from pathlib import Path

import requests

API_BASE = os.getenv("API_BASE", "http://localhost:8080")


def main() -> None:
    payload_path = Path(__file__).with_name("sample_trace.json")
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    response = requests.post(f"{API_BASE}/v1/ingest", json=payload, timeout=15)

    print(f"Status: {response.status_code}")
    try:
        print(response.json())
    except ValueError:
        print(response.text)


if __name__ == "__main__":
    main()
