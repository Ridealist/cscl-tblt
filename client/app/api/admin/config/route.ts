import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = join(process.cwd(), '..', 'config.json');

interface AppSettings {
  numClasses: number;
  numGroupsPerClass: number;
  classStart: number;
  activeClass: number;
}

function readConfig(): AppSettings {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { numClasses: 4, numGroupsPerClass: 4, classStart: 1, activeClass: 1 };
  }
}

export async function GET() {
  return NextResponse.json(readConfig());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const current = readConfig();

    const classStart = typeof body.classStart === 'number' ? body.classStart : current.classStart;
    const numClasses = typeof body.numClasses === 'number' ? body.numClasses : current.numClasses;
    const classEnd = classStart + numClasses - 1;

    const updated: AppSettings = {
      numClasses,
      numGroupsPerClass:
        typeof body.numGroupsPerClass === 'number' ? body.numGroupsPerClass : current.numGroupsPerClass,
      classStart,
      // activeClass가 유효 범위를 벗어나면 classStart로 초기화
      activeClass:
        typeof body.activeClass === 'number'
          ? Math.min(Math.max(body.activeClass, classStart), classEnd)
          : Math.min(Math.max(current.activeClass, classStart), classEnd),
    };

    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
