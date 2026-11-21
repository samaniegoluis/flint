import { describe, expect, it } from 'vitest';
import { GB, MB, sample } from './serverStats.fixture';
import { diskDetail, diskPct, hasFields, hostLine, loadLevel, memDetail, memPct, pctLabel, rateLabel, sizeLabel, statsAria, uptimeLong, uptimeShort, usedOfLabel } from './serverStats';

describe('server resources labels (designs 25a1, 25a9)', () => {
  it('colours by load: green under 60, amber to 85, red above', () => {
    expect(loadLevel(23)).toBe('ok');
    expect(loadLevel(59.9)).toBe('ok');
    expect(loadLevel(60)).toBe('warn');
    expect(loadLevel(85)).toBe('warn');
    expect(loadLevel(85.1)).toBe('hot');
  });
  it('reads the bar as the design does', () => {
    const s = sample();
    expect(pctLabel(s.cpu_pct)).toBe('23%');
    expect(usedOfLabel(s.mem_used, s.mem_total)).toBe('12.1/15.6 GB');
    expect(rateLabel(s.rx_rate)).toBe('1.2 MB/s');
    expect(rateLabel(s.tx_rate)).toBe('84 KB/s');
    expect(pctLabel(diskPct(s))).toBe('92%');
    expect(uptimeShort(s.uptime_secs)).toBe('41 d');
    expect(Math.round(memPct(s))).toBe(78);
  });
  it('reads the detail as the design does', () => {
    const s = sample();
    expect(hostLine(s)).toBe('4 cores · Ubuntu 24.04');
    expect(memDetail(s)).toBe('12.1 GB of 15.6 GB · swap 0.2 of 2.0 GB');
    expect(diskDetail(s)).toBe('183 GB of 200 GB · 17 GB free');
    expect(rateLabel(s.rx_rate, true)).toBe('1.24 MB/s');
    expect(uptimeLong(s.uptime_secs)).toBe('41 days 6 h');
    expect(memDetail(sample({ swap_total: 0, swap_used: 0 }))).toBe('12.1 GB of 15.6 GB');
  });
  it('sizes, rates and uptimes at their edges', () => {
    expect(sizeLabel(512 * MB)).toBe('512 MB');
    expect(sizeLabel(2 * GB)).toBe('2.0 GB');
    expect(sizeLabel(3 * 1024 * GB)).toBe('3.0 TB');
    expect(rateLabel(0)).toBe('0 B/s');
    expect(rateLabel(-5)).toBe('0 B/s');
    expect(rateLabel(512)).toBe('512 B/s');
    expect(rateLabel(25 * MB)).toBe('25 MB/s');
    expect(usedOfLabel(300 * MB, 900 * MB)).toBe('300/900 MB');
    expect(uptimeShort(30)).toBe('1 min');
    expect(uptimeShort(7200)).toBe('2 h');
    expect(uptimeLong(86400)).toBe('1 day');
    expect(uptimeLong(3600 + 12 * 60)).toBe('1 h 12 min');
    expect(pctLabel(140)).toBe('100%');
  });
  it('a sample with no field shows nothing, and the aria label names only what is there', () => {
    const none = sample({ has_cpu: false, has_mem: false, has_net: false, has_disk: false, has_uptime: false, has_load: false });
    expect(hasFields(none)).toBe(false);
    const few = sample({ has_net: false, has_disk: false, has_uptime: false });
    expect(statsAria(few)).toBe('Server resources: CPU 23 percent, RAM 78 percent');
  });
});
