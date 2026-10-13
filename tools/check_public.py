"""Check release content; findings contain paths/rules, never matched values."""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TOP_FILES = {"README.md", ".gitignore", ".gitattributes", ".env.example", "requirements.txt", "requirements-aidp.txt"}
DIRECTORIES = {"race_demo", "notebooks_aidp", "docs", "web", "tests", "tools"}
SUFFIXES = {".py", ".ipynb", ".md", ".html", ".css", ".js"}
RULES = {
    "private-key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "cloud-identifier": r"ocid1\.[a-z0-9]+\.",
    "private-infrastructure": r"[\w.-]+\.(?:oraclecloud|alkamelcloud)\.com",
    "personal-absolute-path": r"/(?:Users|home)/[A-Za-z0-9_.-]+/",
    "github-token": r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})",
    "aws-access-key": r"AKIA[A-Z0-9]{16}",
    "credential-assignment": r'''(?im)^\s*(?:password|secret|api_key|access_token|aks_username|aks_password)\s*[:=]\s*["']?[^\s<>#"']{5,}''',
    "email-address": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
}


def check_text(path, text):
    findings = [f"{path}: {name}" for name, pattern in RULES.items() if re.search(pattern, text)]
    if str(path).endswith(".ipynb"):
        notebook = json.loads(text)
        for cell in notebook["cells"]:
            if cell.get("outputs") or cell.get("execution_count") is not None:
                findings.append(f"{path}: notebook execution output")
            if cell.get("attachments"):
                findings.append(f"{path}: notebook attachment")
    return findings


def main():
    # Includes tracked files even if later ignored; also scans new allowlisted files.
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    findings = []
    for name in sorted(set(filter(None, names))):
        relative = Path(name)
        path = ROOT / relative
        allowed = name in TOP_FILES or (relative.parts[0] in DIRECTORIES and path.suffix in SUFFIXES)
        if not allowed:
            findings.append(f"{name}: outside public allowlist")
            continue
        if path.is_symlink() or not path.is_file():
            findings.append(f"{name}: not a regular file")
            continue
        if path.stat().st_size > 200_000:
            findings.append(f"{name}: unexpectedly large file")
            continue
        findings.extend(check_text(name, path.read_text()))
    if findings:
        print("PUBLIC CONTENT CHECK FAILED")
        print("\n".join(findings))
        raise SystemExit(1)
    print(f"Public content check PASS: {len(set(filter(None, names)))} files. Pattern checks are not a guarantee.")


if __name__ == "__main__":
    main()
