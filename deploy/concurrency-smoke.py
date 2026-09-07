#!/usr/bin/env python3
"""
Safe non-destructive concurrency smoke for MedFlow staging.

Simulates ~50 concurrent authenticated/read traffic patterns:
  - health endpoints
  - login (bounded)
  - dashboard-ish GETs (me, indents, items, notifications)
  - document/vendor list where authorized

Does NOT:
  - spam password resets
  - send Gmail
  - create thousands of records
  - truncate or mutate production-critical data beyond a handful of logins
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


DEFAULT_BASE = "https://medflow-13-50-17-61.sslip.io"


@dataclass
class Stats:
    latencies: list[float] = field(default_factory=list)
    statuses: list[int] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def add(self, status: int, seconds: float, err: str | None = None) -> None:
        self.statuses.append(status)
        self.latencies.append(seconds)
        if err:
            self.errors.append(err)

    def summary(self) -> dict[str, Any]:
        ok = sum(1 for s in self.statuses if 200 <= s < 400)
        err5 = sum(1 for s in self.statuses if s >= 500)
        err4 = sum(1 for s in self.statuses if 400 <= s < 500)
        lats = self.latencies or [0.0]
        return {
            "requests": len(self.statuses),
            "ok_2xx_3xx": ok,
            "http_4xx": err4,
            "http_5xx": err5,
            "error_rate_pct": round(100.0 * (len(self.statuses) - ok) / max(1, len(self.statuses)), 2),
            "p50_s": round(statistics.median(lats), 3),
            "p95_s": round(sorted(lats)[max(0, int(len(lats) * 0.95) - 1)], 3),
            "max_s": round(max(lats), 3),
            "sample_errors": self.errors[:5],
        }


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    return env


def request(
    opener: urllib.request.OpenerDirector,
    base: str,
    method: str,
    path: str,
    data: dict | None = None,
    timeout: float = 45.0,
) -> tuple[int, float, str]:
    headers = {
        "Accept": "application/json, text/html, */*",
        "Origin": base,
        "Referer": f"{base}/login",
        "User-Agent": "medflow-concurrency-smoke/1.0",
    }
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, time.perf_counter() - t0, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return e.code, time.perf_counter() - t0, raw
    except Exception as e:  # noqa: BLE001 — report network failures as 0
        return 0, time.perf_counter() - t0, str(e)


def make_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def worker_session(
    base: str,
    password: str,
    user: str,
    loops: int,
    stats: Stats,
) -> None:
    opener = make_opener()
    status, secs, body = request(
        opener, base, "POST", "/api/session", {"identifier": user, "password": password}
    )
    stats.add(status, secs, None if status == 200 else body[:160])
    if status != 200:
        return

    paths = [
        "/api/me",
        "/api/indents",
        "/api/items",
        "/api/notifications",
        "/api/notifications/unread-count",
        "/dashboard",
        "/api/health/live",
        "/api/health/ready",
    ]
    for i in range(loops):
        path = paths[i % len(paths)]
        method = "GET"
        s, sec, b = request(opener, base, method, path)
        # HTML pages may 307; treat redirects + 2xx as success for smoke.
        ok = 200 <= s < 400
        stats.add(s, sec, None if ok else b[:160])

    # Logout — ignore failures
    s, sec, _ = request(opener, base, "DELETE", "/api/session")
    stats.add(s, sec)


def health_burst(base: str, n: int, stats: Stats) -> None:
    opener = make_opener()
    for _ in range(n):
        for path in ("/api/health/live", "/api/health/ready"):
            s, sec, b = request(opener, base, "GET", path)
            stats.add(s, sec, None if s == 200 else b[:120])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--users", type=int, default=50, help="Concurrent virtual users")
    parser.add_argument("--loops", type=int, default=4, help="Authenticated GETs per user")
    parser.add_argument(
        "--env-file",
        default="/opt/asseflow/app/.env",
        help="Path to staging .env for DEMO_USER_PASSWORD",
    )
    parser.add_argument("--password", default="", help="Override demo password")
    args = parser.parse_args()

    env = load_env(Path(args.env_file))
    password = args.password or env.get("DEMO_USER_PASSWORD") or env.get("ADMIN_INITIAL_PASSWORD")
    if not password:
        print("FAIL missing DEMO_USER_PASSWORD (pass --password or --env-file)")
        return 2

    # Rotate across demo roles so one account is not hammered by login id limit.
    demo_users = [
        "ananya.mehta",
        "rohan.kapoor",
        "kavitha.iyer",
        "suresh.menon",
        "meera.krishnan",
        "arjun.desai",
    ]

    stats = Stats()
    t0 = time.perf_counter()

    # Unauthenticated health concurrency first
    with ThreadPoolExecutor(max_workers=min(args.users, 50)) as pool:
        futs = [pool.submit(health_burst, args.base, 2, stats) for _ in range(min(20, args.users))]
        for f in as_completed(futs):
            f.result()

    with ThreadPoolExecutor(max_workers=args.users) as pool:
        futs = []
        for i in range(args.users):
            user = demo_users[i % len(demo_users)]
            futs.append(pool.submit(worker_session, args.base, password, user, args.loops, stats))
        for f in as_completed(futs):
            f.result()

    elapsed = time.perf_counter() - t0
    summary = stats.summary()
    summary["wall_s"] = round(elapsed, 2)
    summary["concurrent_users"] = args.users
    summary["base"] = args.base
    print(json.dumps(summary, indent=2))

    # Pass criteria: no 5xx storm; error rate under 15% (login id rate-limits may
    # produce some 429 under aggressive reuse of few accounts).
    if summary["http_5xx"] > 0:
        print("RESULT FAIL (5xx present)")
        return 1
    if summary["error_rate_pct"] > 15:
        print("RESULT FAIL (error rate > 15%)")
        return 1
    print("RESULT PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
