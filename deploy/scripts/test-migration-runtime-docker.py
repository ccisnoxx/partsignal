#!/usr/bin/env python3
"""部署单测的显式 Docker adapter；只构造合成 rootfs，不冒充真实依赖环境。"""

import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path


def main():
    backend, state_root = map(Path, sys.argv[1:3])
    args = sys.argv[3:]
    state_root.mkdir(parents=True, exist_ok=True)
    if args[0] == "create":
        name = args[args.index("--name") + 1]
        label = args[args.index("--label") + 1]
        key, value = label.split("=", 1)
        image = args[-1]
        identifier = hashlib.sha256(name.encode()).hexdigest()
        (state_root / (name + ".json")).write_text(json.dumps({
            "Id": identifier, "Image": image, "State": {"Status": "created"},
            "Mounts": [], "HostConfig": {"NetworkMode": "none"},
            "Config": {"Labels": {key: value}},
        }))
        print(identifier)
    elif args[:2] == ["container", "inspect"]:
        path = state_root / (args[2] + ".json")
        if not path.exists():
            print("Error: No such container", file=sys.stderr)
            raise SystemExit(1)
        print("[" + path.read_text() + "]")
    elif args[:2] == ["container", "rm"]:
        path = next(path for path in state_root.glob("*.json")
                    if json.loads(path.read_text())["Id"] == args[2])
        path.unlink()
    elif args[0] == "export":
        with tarfile.open(args[args.index("--output") + 1], "w") as archive:
            for path in sorted(backend.rglob("*")):
                if (path.is_file() and path.suffix not in {".pyc", ".pyo"}
                        and "__pycache__" not in path.parts and ".venv" not in path.parts
                        and (path.suffix == ".py" or path.name == "alembic.ini"
                             or path.is_relative_to(backend / "alembic"))):
                    data = path.read_bytes()
                    member = tarfile.TarInfo("app/" + path.relative_to(backend).as_posix())
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
            data = b"explicit synthetic dependency runtime fixture"
            member = tarfile.TarInfo("usr/local/synthetic-runtime")
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    else:
        raise AssertionError(f"未实现的测试 Docker 行为：{args[0:2]}")


if __name__ == "__main__":
    main()
