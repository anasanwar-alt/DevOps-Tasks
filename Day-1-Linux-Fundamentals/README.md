# health-check.sh — README

A bash script that reports disk usage, memory, CPU usage/load, and the top 5
memory-consuming processes. Output is timestamped and written to both the
terminal and a log file. Metrics crossing a configurable threshold are
flagged with a `WARNING`.

## Usage

```bash
chmod +x health-check.sh
./health-check.sh                                   # defaults: 80% threshold, ./health-check.log
./health-check.sh --threshold 90 --log /var/log/health.log
```

| Option        | Default             | Description                                      |
|---------------|----------------------|---------------------------------------------------|
| `--threshold` | `80`                 | Percent above which a metric triggers a `WARNING` |
| `--log`       | `./health-check.log` | Path to the log file                              |

## Commands used, and why

| Command | Purpose in this script |
|---|---|
| `df -P -h /` | Reports disk space on the root filesystem. `-h` = human-readable sizes (e.g. `8.6G`); `-P` forces POSIX output so columns don't wrap on long filesystem names, keeping `awk` field positions reliable. |
| `free --si` / `free -h --si` | Reports memory totals/used. `--si` uses powers of 1000 for readability; since we only need the used/total **ratio** for the percentage, the unit base doesn't affect correctness. |
| `top -bn1` | Runs `top` once in batch mode (`-b`) for a single iteration (`-n1`) instead of the normal live-refreshing view — needed because we just want one snapshot to parse, not an interactive session. |
| `uptime` | Reports system uptime and the 1/5/15-minute load averages, used here for the load-average portion of the report. |
| `ps -eo user,pid,%mem,comm --sort=-%mem` | Lists every process (`-e`) with the exact columns we want (`-o user,pid,%mem,comm`), sorted descending by memory percent (`--sort=-%mem`) so the heaviest processes appear first. |
| `awk` (throughout) | Extracts and formats specific fields/columns from the raw output of the commands above (e.g. isolating the disk-use percentage, or the idle-CPU field from `top`). |
| `date '+%Y-%m-%d %H:%M:%S'` | Generates the timestamp prefix on every log line, so events are chronologically traceable. |
| `tee -a "$LOG_FILE_PATH"` | Writes each line to the terminal **and** appends it to the log file in one step, instead of choosing between screen output and file output. |
| `(( VALUE >= THRESHOLD ))` | Bash arithmetic comparison used to decide whether a metric should be flagged with a `WARNING`. |
| `while (( $# > 0 )) ... case ... shift 2` | Parses `--threshold` and `--log` as long-form command-line options (bash's built-in `getopts` doesn't support `--long-flags`), consuming each flag and its value with `shift 2` per iteration. |

## How the metrics are derived

- **Disk %** — parsed from the `Use%` column of `df`.
- **Memory %** — computed as `(used / total) * 100` from `free`.
- **CPU usage %** — computed as `100 - idle%`, where idle% is read from `top`'s `%Cpu(s)` summary line.
- **CPU load average** — the 1/5/15-minute values from `uptime`, isolated with `awk -F'load average:'`.
- **Top 5 processes** — `ps` sorted by `%MEM` descending, first 5 rows after the header.

## Known limitation (WSL)

On WSL, load average is often `0.00, 0.00, 0.00` even under light use — this is
expected behavior for the WSL2 kernel's lightweight VM, not a script bug.

## Man pages consulted

`man df`, `man free`, `man top`, `man ps`, `man uptime`, `man awk`, `man bash`
(for parameter expansion, `(( ))` arithmetic, and `case` statements).