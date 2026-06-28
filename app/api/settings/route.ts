import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

type SettingsConfig = {
  autoCategory: boolean;
  defaultCurrency: 'KZT' | 'USD' | 'RUB';
  autoMatchThreshold: number;
  manualReviewThreshold: number;
  usdRate: number;
  rubRate: number;
};

const configPath = path.join(process.cwd(), 'config.json');

const defaultConfig: SettingsConfig = {
  autoCategory: true,
  defaultCurrency: 'KZT',
  autoMatchThreshold: 0.85,
  manualReviewThreshold: 0.7,
  usdRate: 450.0,
  rubRate: 5.0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function toThreshold(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  if (value < 0 || value > 1) {
    return fallback;
  }

  return value;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeConfig(input: unknown): SettingsConfig {
  const current = isRecord(input) ? input : {};
  const autoMatchThreshold = toThreshold(current.autoMatchThreshold, defaultConfig.autoMatchThreshold);
  const manualReviewThreshold = toThreshold(
    current.manualReviewThreshold,
    defaultConfig.manualReviewThreshold
  );
  const defaultCurrency =
    current.defaultCurrency === 'USD' || current.defaultCurrency === 'RUB' || current.defaultCurrency === 'KZT'
      ? current.defaultCurrency
      : defaultConfig.defaultCurrency;
  const usdRate = toPositiveNumber(current.usdRate, defaultConfig.usdRate);
  const rubRate = toPositiveNumber(current.rubRate, defaultConfig.rubRate);

  return {
    autoCategory: toBoolean(current.autoCategory, defaultConfig.autoCategory),
    defaultCurrency,
    autoMatchThreshold,
    manualReviewThreshold: Math.min(manualReviewThreshold, autoMatchThreshold),
    usdRate,
    rubRate,
  };
}

function readConfig(): SettingsConfig {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return normalizeConfig(JSON.parse(data));
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }

  return defaultConfig;
}

export async function GET() {
  return NextResponse.json(readConfig());
}

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const newConfig = await req.json();
    const currentConfig = readConfig();
    const mergedConfig = normalizeConfig({ ...currentConfig, ...(isRecord(newConfig) ? newConfig : {}) });

    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2), 'utf8');
    return NextResponse.json({ success: true, config: mergedConfig });
  } catch (error: unknown) {
    console.error('Error updating settings:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
