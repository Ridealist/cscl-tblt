import re
import sys
from types import SimpleNamespace

sys.modules.setdefault(
    "livekit",
    SimpleNamespace(api=SimpleNamespace(LiveKitAPI=object, S3Upload=object)),
)
from egress_recorder import EgressRecorder


def test_egress_recording_filepath_includes_room_sid_and_timestamp() -> None:
    recorder = EgressRecorder(
        "task_11_17_yujeong_jeong_202315c",
        "RM_NzGHwKNz7iAu",
    )

    assert re.fullmatch(
        r"recordings/task_11_17_yujeong_jeong_202315c-RM_NzGHwKNz7iAu-\d{8}_\d{6}\.mp3",
        recorder.filepath,
    )
