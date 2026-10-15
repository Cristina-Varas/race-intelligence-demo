"""Explicit post-session archive command. Never starts AKS or the web server."""
from __future__ import annotations
import argparse, json, os
from .services.event_archive import LocalEventArchiveStore, OCIObjectStorageEventArchiveStore

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("segment_path")
    parser.add_argument("--archive-root", default=os.getenv("RACE_EVENT_ARCHIVE_DIR"))
    parser.add_argument("--materialize-cache")
    parser.add_argument("--target", choices=("local", "oci"), default="local")
    args=parser.parse_args()
    if args.target == "local" and not args.archive_root:
        parser.error("Local archives require --archive-root or RACE_EVENT_ARCHIVE_DIR on persistent storage.")
    store=OCIObjectStorageEventArchiveStore() if args.target == "oci" else LocalEventArchiveStore(args.archive_root)
    result=store.archive_segment(args.segment_path)
    materialized=store.materialize_segment(result.logical_session_id,result.segment_id,args.materialize_cache) if args.materialize_cache else None
    print(json.dumps({"status":result.status,"logical_session_id":result.logical_session_id,"segment_id":result.segment_id,"archive_location":result.location,"materialized_path":str(materialized) if materialized else None},sort_keys=True))

if __name__ == "__main__": main()
