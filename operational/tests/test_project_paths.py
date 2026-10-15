from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'src'))
from project_paths import find_project_root, add_src_to_path
import pytest

def make_project(path):
    (path/'src').mkdir(parents=True); (path/'config').mkdir(); (path/'config/settings.yaml').write_text(''); (path/'requirements.txt').write_text('')

def test_root_search_aidp_and_errors(tmp_path):
    local=tmp_path/'repo'; make_project(local); nested=local/'notebooks'/'x'; nested.mkdir(parents=True)
    assert find_project_root(nested,tmp_path/'missing')==local
    aidp=tmp_path/'Workspace'/'redbull-race-intelligence-v2'; make_project(aidp)
    assert find_project_root(tmp_path/'ipykernel',aidp)==aidp
    with pytest.raises(RuntimeError,match='Expected markers'): find_project_root(tmp_path/'none',tmp_path/'nope')

def test_src_added_once(tmp_path):
    make_project(tmp_path); paths=[]; add_src_to_path(tmp_path,paths); add_src_to_path(tmp_path,paths); assert len(paths)==1
