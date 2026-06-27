import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading config file:', e);
  }
  return {
    autoCategory: true,
    defaultCurrency: 'KZT',
    autoMatchThreshold: 0.85,
    manualReviewThreshold: 0.70
  };
}

export async function GET() {
  const config = readConfig();
  return NextResponse.json(config);
}

export async function POST(req: Request) {
  try {
    const newConfig = await req.json();
    const currentConfig = readConfig();
    const mergedConfig = { ...currentConfig, ...newConfig };

    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2), 'utf8');
    return NextResponse.json({ success: true, config: mergedConfig });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
