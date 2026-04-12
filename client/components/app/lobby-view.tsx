'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Room {
  name: string;
  numParticipants: number;
}

interface LobbyViewProps {
  onJoin: (participantName: string, roomName: string) => void;
}

export function LobbyView({ onJoin, ref }: React.ComponentProps<'div'> & LobbyViewProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [activeRooms, setActiveRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [error, setError] = useState('');
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstNameRef.current?.focus();
    fetchRooms();
  }, []);

  async function fetchRooms() {
    setLoadingRooms(true);
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setActiveRooms(data.rooms ?? []);
    } catch {
      setActiveRooms([]);
    } finally {
      setLoadingRooms(false);
    }
  }

  function handleJoin() {
    if (!firstName.trim()) {
      setError('이름(First Name)을 입력해주세요.');
      return;
    }
    if (!lastName.trim()) {
      setError('성(Last Name)을 입력해주세요.');
      return;
    }
    if (!roomName.trim()) {
      setError('채팅방 이름을 입력하거나 아래에서 선택해주세요.');
      return;
    }
    // 영어 어순: 이름(First) + 성(Last)
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    onJoin(fullName, roomName.trim());
  }

  const previewName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

  return (
    <div ref={ref} className="mx-auto flex w-full max-w-sm flex-col gap-5">
      {/* 이름 입력 — 성/이름 분리 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm font-semibold">이름</label>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">이름 (First Name)</span>
            <input
              ref={firstNameRef}
              type="text"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="예: Jungkook"
              maxLength={20}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">성 (Last Name)</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="예: Jeon"
              maxLength={20}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>
        {previewName && (
          <p className="text-muted-foreground text-xs">
            에이전트가 부를 이름: <span className="text-foreground font-medium">{previewName}</span>
          </p>
        )}
      </div>

      {/* 채팅방 이름 입력 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm font-semibold">채팅방 이름</label>
        <input
          type="text"
          value={roomName}
          onChange={(e) => {
            setRoomName(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="새 채팅방 이름 입력 또는 아래서 선택"
          maxLength={50}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        />
      </div>

      {/* 활성 채팅방 목록 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">현재 활성 채팅방</span>
          <button
            onClick={fetchRooms}
            disabled={loadingRooms}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            {loadingRooms ? '불러오는 중...' : '새로고침'}
          </button>
        </div>

        <div className="border-border flex flex-col gap-1 rounded-lg border p-1">
          {loadingRooms ? (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">불러오는 중...</p>
          ) : activeRooms.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">
              활성 채팅방 없음 — 새 채팅방 이름을 입력해 첫 번째로 입장하세요.
            </p>
          ) : (
            activeRooms.map((room) => (
              <button
                key={room.name}
                onClick={() => {
                  setRoomName(room.name);
                  setError('');
                }}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  roomName === room.name
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <span className="font-medium">{room.name}</span>
                <span className="text-xs opacity-70">{room.numParticipants}명 참여 중</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 에러 */}
      {error && <p className="text-destructive text-xs">{error}</p>}

      {/* 입장 버튼 */}
      <Button
        size="lg"
        onClick={handleJoin}
        className="w-full rounded-full font-mono text-xs font-bold tracking-wider uppercase"
      >
        입장하기
      </Button>
    </div>
  );
}
