#!/usr/bin/bash

THRESHOLD=80
LOG_FILE_PATH="./health-check.log"

while (( $# > 0 )); do
    case "$1" in
        --threshold)
            if (( $# < 2 )); then
                echo "Missing value for --threshold"
                exit 1
            fi

            THRESHOLD="$2"
            shift 2
            ;;
        --log)
            if (( $# < 2 )); then
                echo "Missing value for --log"
                exit 1
            fi

            LOG_FILE_PATH="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: $0 [--threshold PERCENT] [--log PATH]" >&2
            exit 1
            ;;
    esac
done

log () {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE_PATH"
}

# Storage
DISK_USAGE_PERCENTAGE=$(
    df -P -h / |
    awk 'NR == 2 {
            gsub("%", "", $5)
            print $5
        }'
)
DISK_USAGE_LINE=$(
    df -P -h / |
    awk -v percentage="$DISK_USAGE_PERCENTAGE" '
        NR == 2 {
            printf "DISK USAGE: %s of %s storage used, usage percentage: %s%%",
                   $3, $2, percentage
        }'
)

log "$DISK_USAGE_LINE"
if (( DISK_USAGE_PERCENTAGE >= THRESHOLD )); then
    log "WARNING: disk usage above ${THRESHOLD}% (current: ${DISK_USAGE_PERCENTAGE}%)"
fi

#Memory
MEMORY_USAGE_PERCENTAGE=$(
    free --si |
    awk 'NR == 2 {printf "%.0f", ($3 / $2) * 100}'
)
MEMORY_USAGE_LINE=$(
    free -h --si |
    awk -v percentage="$MEMORY_USAGE_PERCENTAGE" '
        NR == 2 {
            printf "MEMORY USAGE: %s of %s memory used, usage percentage: %s%%",
                   $3, $2, percentage
        }
    '
)

log "${MEMORY_USAGE_LINE}"
if (( MEMORY_USAGE_PERCENTAGE >= THRESHOLD )); then
    log "WARNING: memory usage above ${THRESHOLD}% (current: ${MEMORY_USAGE_PERCENTAGE}%)"
fi

#CPU Usage
CPU_USAGE_PERCENTAGE=$(
    top -bn1 |
    awk '/Cpu\(s\)/ {
            printf "%.0f", 100 - $8
         }'
)

CPU_LOAD=$(
    uptime |
    awk -F'load average:' '{gsub(/^ /, "", $2); print $2}'
)

CPU_USAGE_LINE="CPU USAGE: ${CPU_USAGE_PERCENTAGE}%, CPU LOAD AVERAGE: ${CPU_LOAD}"

log "$CPU_USAGE_LINE"

if (( CPU_USAGE_PERCENTAGE >= THRESHOLD )); then
    log "WARNING: CPU usage above ${THRESHOLD}% (current: ${CPU_USAGE_PERCENTAGE}%)"
fi

#Top 5 processes by memory
TOP_MEMORY_PROCESSES=$(
    ps -eo user,pid,%mem,comm --sort=-%mem |
    awk 'NR <= 6'
)

log "TOP 5 PROCESSES BY MEMORY:
$TOP_MEMORY_PROCESSES"
