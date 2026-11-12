import { describe, expect, it } from 'vitest';
import { chooseRenderer, isSoftwareRenderer } from './deskRenderer';
import { FrameMeter, linkLabel, pipelineLabel, ratesBetween, rereadLabel, type StatsSample } from './rdpStats';
import type { RdpStats } from '../api/types';

const core = (p: Partial<RdpStats> = {}): RdpStats => ({ updates: 0, bytes_in: 0, commands: 0, decode_us: 0, frames_read: 0, pipeline: 'gfx', codec: 'progressive', h264: true, rereads: 0, stale_px: 0, link_kbps: 0, link_rtt_ms: 0, mode: 'auto', ...p });

describe('RDP drawing', () => {
  it('uses WebGL only on a real GPU, unless a test forces a renderer', () => {
    expect(chooseRenderer({ webgl: true, renderer: 'Apple M2 Pro' })).toBe('webgl');
    expect(chooseRenderer({ webgl: true, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).toBe('2d');
    expect(chooseRenderer({ webgl: true, renderer: 'llvmpipe (LLVM 17.0.6, 256 bits)' })).toBe('2d');
    expect(chooseRenderer({ webgl: true, renderer: 'Microsoft Basic Render Driver' })).toBe('2d');
    expect(chooseRenderer({ webgl: false, renderer: '' })).toBe('2d');
    expect(chooseRenderer({ webgl: true, renderer: 'Apple M2 Pro' }, '2d')).toBe('2d');
    expect(chooseRenderer({ webgl: true, renderer: 'llvmpipe' }, 'webgl')).toBe('webgl');
    expect(chooseRenderer({ webgl: false, renderer: '' }, 'webgl')).toBe('2d');
    expect(isSoftwareRenderer('Mesa Intel(R) UHD Graphics 620')).toBe(false);
  });
});

describe('RDP statistics', () => {
  it('remembers when frames were drawn, for the latency of the first one after an input', () => {
    const m = new FrameMeter();
    m.add(100, 10);
    m.add(100, 20);
    m.add(50, 35);
    expect(m.frames).toBe(3);
    expect(m.bytes).toBe(250);
    expect(m.firstAfter(15)).toBe(20);
    expect(m.firstAfter(35)).toBeNull();
    for (let i = 0; i < 100; i++) m.add(1, 100 + i);
    expect(m.times.length).toBe(64);
  });

  it('turns two samples a second apart into rates', () => {
    const a: StatsSample = { at: 1000, drawn: 10, read: 1e6, core: core({ updates: 100, bytes_in: 10_000, commands: 50, decode_us: 5_000 }) };
    const b: StatsSample = { at: 2000, drawn: 40, read: 4e6, core: core({ updates: 130, bytes_in: 135_000, commands: 70, decode_us: 9_000 }) };
    const r = ratesBetween(a, b);
    expect(r.fps).toBeCloseTo(30);
    expect(r.updates).toBeCloseTo(30);
    expect(r.kbps).toBeCloseTo(1000);
    expect(r.decodeMs).toBeCloseTo(0.2);
    expect(r.channelMBps).toBeCloseTo(3);
  });

  it('gives zeros for samples too close together or counters that went back (a reconnect)', () => {
    const a: StatsSample = { at: 1000, drawn: 10, read: 0, core: core({ updates: 100 }) };
    expect(ratesBetween(a, { ...a, at: 1010 }).fps).toBe(0);
    expect(ratesBetween(a, { ...a, at: 2000, core: core({ updates: 5 }) }).updates).toBe(0);
  });

  it('names the pipeline and its codec', () => {
    expect(pipelineLabel(core())).toBe('graphics pipeline · progressive');
    expect(pipelineLabel(core({ codec: '' }))).toBe('graphics pipeline');
    expect(pipelineLabel(core({ codec: 'clearcodec,planar,avc420' }))).toBe('graphics pipeline · clearcodec, planar, avc420');
    expect(pipelineLabel(core({ pipeline: 'bitmap', codec: '' }))).toBe('bitmap updates');
    expect(pipelineLabel(core({ pipeline: '' }))).toBe('');
  });
});

describe('RDP link and re-reads (milestone 35)', () => {
  it('shows the measured link only once the server has measured it', () => {
    expect(linkLabel(core())).toBe('');
    expect(linkLabel(core({ link_kbps: 20000, link_rtt_ms: 12 }))).toBe('20.0 Mbit/s · 12 ms');
    expect(linkLabel(core({ link_kbps: 800 }))).toBe('800 kbit/s');
  });
  it('counts re-reads and the stale pixels they fixed', () => {
    expect(rereadLabel(core())).toBe('');
    expect(rereadLabel(core({ rereads: 1 }))).toBe('1 re-read · nothing stale');
    expect(rereadLabel(core({ rereads: 3, stale_px: 12345 }))).toBe('3 re-reads · 12,345 stale px fixed');
  });
});
