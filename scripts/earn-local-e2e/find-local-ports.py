#!/usr/bin/env python3
"""Avoid existing local services; never kill another session to free test ports."""
from contextlib import ExitStack
import random
import socket
import sys

start, width = map(int, sys.argv[1:])
if start < 1024 or width < 1 or start + width + 60 > 65535:
    raise SystemExit("Invalid local fixture port range")
for _ in range(200):
    base = random.randrange(start, start + width)
    try:
        with ExitStack() as stack:
            # Validator RPC/WS/faucet/gossip/dynamic ports, realtime and PG.
            # Check TCP and UDP together, including wildcard-bound services.
            for port in range(base, base + 61):
                for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
                    sock = stack.enter_context(socket.socket(socket.AF_INET, kind))
                    sock.bind(("0.0.0.0", port))
    except OSError:
        continue
    print(base)
    break
else:
    raise SystemExit("No free local fixture port block; existing services left untouched")
