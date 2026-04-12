'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface LobbyViewProps {
  onJoin: (participantName: string, roomName: string) => void;
}

export function LobbyView({ onJoin, ref }: React.ComponentProps<'div'> & LobbyViewProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [activeClass, setActiveClass] = useState<number | null>(null);
  const [rooms, setRooms] = useState<{ name: string; numParticipants: number }[]>([]);
  const [error, setError] = useState('');
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstNameRef.current?.focus();
    fetchRooms();
  }, []);

  async function fetchRooms() {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setRooms(data.rooms ?? []);
      setActiveClass(data.activeClass ?? null);
      setSelectedGroup(null);
    } catch {
      // 무시
    }
  }

  const selectedRoomName =
    activeClass !== null && selectedGroup !== null
      ? `${activeClass}반-${selectedGroup}그룹`
      : null;

  function handleJoin() {
    if (!firstName.trim()) {
      setError('이름(First Name)을 입력해주세요.');
      return;
    }
    if (!lastName.trim()) {
      setError('성(Last Name)을 입력해주세요.');
      return;
    }
    if (!selectedRoomName) {
      setError('그룹을 선택해주세요.');
      return;
    }
    onJoin(`${firstName.trim()} ${lastName.trim()}`, selectedRoomName);
  }

  const previewName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

  return (
    <div ref={ref} className="mx-auto flex w-full max-w-sm flex-col gap-5">
      {/* 이름 입력 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-foreground text-sm font-semibold">이름</label>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">이름 (First Name)</span>
            <input
              ref={firstNameRef}
              type="text"
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setError(''); }}
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
              onChange={(e) => { setLastName(e.target.value); setError(''); }}
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

      {/* 그룹 선택 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-foreground text-sm font-semibold">
            그룹 선택
            {activeClass !== null && (
              <span className="text-muted-foreground ml-2 font-normal">({activeClass}반)</span>
            )}
          </label>
          <button
            onClick={fetchRooms}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
          >
            새로고침
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {rooms.map((room, i) => {
            const groupNum = i + 1;
            return (
              <button
                key={room.name}
                onClick={() => { setSelectedGroup(groupNum); setError(''); }}
                className={`flex flex-col items-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  selectedGroup === groupNum
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted text-foreground'
                }`}
              >
                <span>{groupNum}그룹</span>
                {room.numParticipants > 0 && (
                  <span className={`text-xs ${selectedGroup === groupNum ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {room.numParticipants}명
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedRoomName && (
        <p className="text-muted-foreground text-xs">
          입장할 방: <span className="text-foreground font-semibold">{selectedRoomName}</span>
        </p>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

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
