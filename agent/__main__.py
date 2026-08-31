"""python -m agent /etc/media-admin-agent.toml"""

import asyncio
import logging
import sys

from . import config
from .client import Agent


def main():
    if len(sys.argv) != 2:
        print("usage: python -m agent <config.toml>", file=sys.stderr)
        sys.exit(2)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = config.load(sys.argv[1])
    try:
        asyncio.run(Agent(cfg).run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
