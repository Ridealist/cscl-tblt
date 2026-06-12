import asyncio
import logging
import os
from datetime import datetime

from livekit import api

log = logging.getLogger(__name__)


class EgressRecorder:
    """LiveKit Egress API를 통한 룸 전체 오디오 녹음.

    모든 참가자(학생 + AI)의 음성을 혼합하여 S3에 MP3 파일로 저장한다.

    사용법:
        egress = EgressRecorder(room_name, session_id)
        await egress.start()   # session.start() 직후
        ...
        await egress.stop()    # 룸 종료 시
    """

    def __init__(self, room_name: str, session_id: str) -> None:
        self.room_name = room_name
        self.session_id = session_id
        self.egress_id: str | None = None
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._filepath = f"recordings/{room_name}--{ts}.mp3"

    @property
    def filepath(self) -> str:
        return self._filepath

    def _make_client(self) -> api.LiveKitAPI:
        return api.LiveKitAPI(
            url=os.environ["LIVEKIT_URL"],
            api_key=os.environ["LIVEKIT_API_KEY"],
            api_secret=os.environ["LIVEKIT_API_SECRET"],
        )

    def _s3_upload(self) -> api.S3Upload:
        raw = os.environ.get("S3_ENDPOINT", "").strip()
        # http(s)://로 시작하는 경우만 유효한 엔드포인트로 인정 (AWS S3는 비워야 함)
        endpoint = raw if raw.startswith("http") else None
        return api.S3Upload(
            bucket=os.environ["S3_BUCKET"],
            region=os.environ["S3_REGION"],
            access_key=os.environ["AWS_ACCESS_KEY"],
            secret=os.environ["AWS_SECRET_ACCESS_KEY"],
            endpoint=endpoint,
            force_path_style=bool(endpoint),  # Cloudflare R2 / MinIO 등에만 True
        )

    async def start(self) -> None:
        """Egress 녹음 시작."""
        lk = self._make_client()
        try:
            resp = await lk.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=self.room_name,
                    audio_only=True,
                    file_outputs=[
                        api.EncodedFileOutput(
                            file_type=api.EncodedFileType.MP3,
                            filepath=self._filepath,
                            s3=self._s3_upload(),
                        )
                    ],
                )
            )
            self.egress_id = resp.egress_id
            log.info(
                "Egress started: id=%s → s3://%s/%s",
                self.egress_id,
                os.environ["S3_BUCKET"],
                self._filepath,
            )
        except Exception:
            log.exception("Failed to start Egress")
        finally:
            await lk.aclose()

    async def stop(self) -> None:
        """Egress 녹음 종료."""
        if not self.egress_id:
            return
        lk = self._make_client()
        try:
            await lk.egress.stop_egress(
                api.StopEgressRequest(egress_id=self.egress_id)
            )
            log.info("Egress stopped: id=%s", self.egress_id)
        except Exception:
            log.exception("Failed to stop Egress: id=%s", self.egress_id)
        finally:
            await lk.aclose()
