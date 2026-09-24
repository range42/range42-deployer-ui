"""Local Ansible consumer's fake Docker executable; never talks to a daemon."""
import base64
import json
import os
import pathlib
import sys

root = pathlib.Path(os.environ["R42_WORKLOAD_TEST_ROOT"])
settings = json.loads((root / "consumer.json").read_text())
mode, marker = settings["mode"], settings["marker"]
args = sys.argv[1:]
assert args[:2] == ["--host", "unix:///var/run/docker.sock"]
args = args[2:]
with (root / "docker-calls.jsonl").open("a") as output:
    output.write(json.dumps(args) + "\n")
owner = root / "guest" / marker / "owner.txt"
label = owner.read_text() if owner.exists() else "foreign"
started = root / "started"
if args == ["compose", "version"]:
    print("Docker Compose version v2.39.0")
    sys.exit(1 if mode == "missing" else 0)
if args == ["info"]:
    sys.exit(0)
if args[:2] == ["container", "ls"]:
    print("collision" if mode == "foreign" else "owned" if started.exists() else "")
    sys.exit(0)
if args[:2] in [["network", "ls"], ["volume", "ls"]]:
    print("collision" if mode == "foreign-" + args[0] else "")
    sys.exit(0)
if args[:2] in [["network", "inspect"], ["volume", "inspect"]]:
    print(json.dumps([{"Labels": {"io.range42.workload": "foreign"}}]))
    sys.exit(0)
if args[:2] == ["container", "inspect"]:
    print(json.dumps([{"Config": {"Labels": {"io.range42.workload": label}}, "State": {"Running": mode != "stopped"}}]))
    sys.exit(0)
assert args[0] == "compose"
if mode == "secret":
    assert os.environ.get("DB_PASSWORD") == "consumer-fixture-value"
payload = pathlib.Path(args[args.index("--project-directory") + 1])
expected = json.loads((root / "expected.json").read_text())
assert all((payload / name).read_bytes() == base64.b64decode(value) for name, value in expected.items()), "copy bytes/path mismatch"
assert args[args.index("--env-file") + 1] == "/dev/null"
assert (payload / "compose.yml").is_file()
assert args.count("-f") == 1
if "up" in args:
    assert args[args.index("up"):] == ["up", "--detach", "--build", "--force-recreate", "--wait", "--wait-timeout", "120", *settings["services"]]
    started.touch()
    sys.exit(1 if mode == "unhealthy" else 0)
if "down" in args:
    assert args[-3:] == ["down", "--timeout", "30"]
    started.unlink(missing_ok=True)
    sys.exit(0)
assert args[-2:] == ["config", "--quiet"]
