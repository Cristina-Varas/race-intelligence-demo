import pandas as pd
from synthetic_field import generate_synthetic_field

def test_synthetic_field_is_reproducible_and_bounded():
    p=pd.DataFrame({'driver_id':[1,2,3],'pooled_median_pace':[80.,81.,83.],'pooled_MAD':[.2,.4,.8],'support_status':['sufficient']*3})
    a=generate_synthetic_field(p,100,42); b=generate_synthetic_field(p,100,42)
    pd.testing.assert_frame_equal(a,b)
    assert len(a)==100 and a.synthetic_driver_id.is_unique
    assert a.synthetic_driver_id.str.startswith('SYN_').all() and set(a.source_type)=={'synthetic'}
    assert a.base_pace_seconds.between(80,83).all()
