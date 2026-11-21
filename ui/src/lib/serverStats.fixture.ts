// A sample as design 25a9 shows it, for the tests.
import type { ServerSample } from '../api/types';

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

export function sample(over: Partial<ServerSample> = {}): ServerSample {
  return {
    session: 's1', os: 'Ubuntu 24.04', cores: 4,
    has_cpu: true, cpu_pct: 23.4,
    has_mem: true, mem_total: 15.6 * GB, mem_used: 12.1 * GB, swap_total: 2 * GB, swap_used: 0.2 * GB,
    has_net: true, rx_rate: 1.24 * MB, tx_rate: 84 * 1024, interfaces: ['eth0'],
    has_load: true, load1: 0.82, load5: 0.71, load15: 0.64,
    has_uptime: true, uptime_secs: 41 * 86400 + 6 * 3600 + 120,
    has_disk: true, disk_total: 200 * GB, disk_used: 183 * GB, disk_avail: 17 * GB,
    ...over,
  };
}

