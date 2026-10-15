import numpy as np
import pandas as pd

from uncertainty_simulation import probability_curve, thresholds


def _field():
    return pd.DataFrame({"driver_id":[1,2],"base_pace_seconds":[80.3,81.0],"historical_rank":[1,2],"support":[10,10],"source_type":["historical","historical"]})


def test_reproducible_zero_noise_and_thresholds():
    field=_field(); pools={1:np.array([0.0]),2:np.array([0.0])}; delays=np.array([0.0,3.0,7.0])
    a,_=probability_curve(field,80.1,delays,100,42,pools,np.array([0.0]),zero_noise=True)
    b,_=probability_curve(field,80.1,delays,100,42,pools,np.array([0.0]),zero_noise=True)
    pd.testing.assert_frame_equal(a,b)
    assert a.full_field_catch_probability.tolist()==[1.0,1.0,0.0]
    assert a.full_field_catch_probability.between(0,1).all()
    assert thresholds(a,[.5,.9],100).maximum_start_delay_seconds.tolist()==[3.0,3.0]
