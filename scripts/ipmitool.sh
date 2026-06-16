#!/bin/bash

VERSION="0.0.5"

A1_HOSTNAME="Jumper"
N2_HOSTNAME="N2-TSC-Service-Jumper"
TSS_HOSTNAME="TSS-Jumper"
HOSTNAME=$(cat /etc/hostname)

POWER_STATUS=1
POWER_ON=$((${POWER_STATUS}+1))
POWER_OFF=$((${POWER_ON}+1))
POWER_CYCLE=$((${POWER_OFF}+1))
POWER_RESET=$((${POWER_CYCLE}+1))
SERIAL_NUMBER=$((${POWER_RESET}+1))
BMC_INFO=$((${SERIAL_NUMBER}+1))
BMC_GUID=$((${BMC_INFO}+1))
BMC_RESET_COLD=$((${BMC_GUID}+1))
BMC_SELFTEST=$((${BMC_RESET_COLD}+1))
FRU_PRINT=$((${BMC_SELFTEST}+1))
SDR_INFO=$((${FRU_PRINT}+1))
SDR_TYPE_LIST=$((${SDR_INFO}+1))
SDR_TYPE_TYPE=$((${SDR_TYPE_LIST}+1))
SDR_GET=$((${SDR_TYPE_TYPE}+1))
SDR_ELIST=$((${SDR_GET}+1))
SDR_LIST=$((${SDR_ELIST}+1))
SENSOR_LIST=$((${SDR_LIST}+1))
SOL_ACTIVATE=$((${SENSOR_LIST}+1))
SOL_DEACTIVATE=$((${SOL_ACTIVATE}+1))
LAN_PRINT=$((${SOL_DEACTIVATE}+1))
USER_LIST=$((${LAN_PRINT}+1))
SEL_INFO=$((${USER_LIST}+1))
SEL_ELIST=$((${SEL_INFO}+1))
SEL_GET=$((${SEL_ELIST}+1))
SEL_DELETE=$((${SEL_GET}+1))
SEL_CLEAR=$((${SEL_DELETE}+1))
SEL_TIME_GET=$((${SEL_CLEAR}+1))
SEL_TIME_SET=$((${SEL_TIME_GET}+1))
CLEAR_SBIOS=$((${SEL_TIME_SET}+1))
BMC_REBOOT=$((${CLEAR_SBIOS}+1))
BMC_RESTORE=$((${BMC_REBOOT}+1))
RACK_LIST=$((${BMC_RESTORE}+1))

base_ipmi() {
    local BMC_IP=${1}
    local CMD=${2}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} ${CMD} 
}

serial_number() {
    local BMC_IP=${1}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} fru print 0 | grep "Product Serial"
}

fru_print() {
    local BMC_IP=${1}
    local FRU_ID=${2}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} fru print ${FRU_ID}
}

sdr_type_type() {
    local BMC_IP=${1}
    local SDR_TYPE=${2}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr type ${SDR_TYPE}
}

sdr_get() {
    local BMC_IP=${1}
    local SENSOR_ID=${2}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr get ${SENSOR_ID}
}

sdr_elist() {
    local BMC_IP=${1}
    local STRING=${2}

    if [ ! -z "${STRING}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr elist | grep -i ${STRING}
    else
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr elist
    fi
}

sdr_list() {
    local BMC_IP=${1}
    local STRING=${2}

    if [ ! -z "${STRING}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr list | grep -i ${STRING}
    else
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sdr list
    fi
}

sensor_list() {
    local BMC_IP=${1}
    local STRING=${2}

    if [ ! -z "${STRING}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sensor list | grep -i ${STRING}
    else
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sensor list
    fi
}

sel_elist() {
    local BMC_IP=${1}
    local STRING=${2}

    if [ ! -z "${STRING}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sel elist | grep -i ${STRING}
    else
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sel elist
    fi
}

sel_get() {
    local BMC_IP=${1}
    local ID=${2}

    if [ ! -z "${ID}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sel get ${ID} 
    else
        echo "please input get ID"
    fi
}

sel_delete() {
    local BMC_IP=${1}
    local ID=${2}

    if [ ! -z "${ID}" ]; then
        ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sel delete ${ID} 
    else
        echo "please input get ID"
    fi
}

sel_time_set() {
    local BMC_IP=${1}
    local TIME=${2}
    ipmitool -U admin -P admin -I lanplus -H ${BMC_IP} sel time set ${TIME}
}

rack_list() {
    local -n RACK_NUM=${1}
    local -n RACK_CHAR=${2}
    local BMC_IP=""
    local OS_IP=""

    printf "%-10s\t%-25s\t%-15s\t%-15s\t%s\n" "RACK_ID" "SERIAL_NUMBER" "BMC_IP" "OS_IP" "BMC_VERSION"
    for i in ${RACK_NUM[@]}; do
        for j in ${RACK_CHAR[@]}; do
            printf "%-10s\t" ${i}${j}
            RACK_IP=$(change_rack_id_to_ip ${i}${j} "BMC")
            if [ ! -z ${RACK_IP} ];then
                BMC_IP=${RACK_IP}
            fi
            check_ip ${BMC_IP}
            if [ ${?} -eq 0 ]; then
                SERIAL_NUMBER=$(bash ipmitool.sh ${BMC_IP} "--serial_number" | awk '{print $4}')
                printf "%-25s\t%-15s\t" ${SERIAL_NUMBER} ${BMC_IP}
            else
                printf "%-25s\t%-15s\t" 
            fi
            RACK_IP=$(change_rack_id_to_ip ${i}${j} "OS")
            if [ ! -z ${RACK_IP} ];then
                OS_IP=${RACK_IP}
            fi
            check_ip ${OS_IP}
            if [ ${?} -eq 0 ]; then
                printf "%-15s\t" ${OS_IP}
            else
                printf "%-15s\t" 
            fi
#            check_ip ${BMC_IP}
#            if [ ${?} -eq 0 ]; then
#                bash redfish.sh ${BMC_IP} --bmc_version | awk '{print $2}'
#            fi
            printf "\n"
        done
    done
}

change_rack_id_to_ip() {
    local RACK_ID=${1}
    local PLATFORM=${2}

    CHAR=$(echo ${RACK_ID} | sed 's/[^A-W,^a-w]//g')
    if [ ! -z ${CHAR} ]; then
        NUM=$(echo ${RACK_ID} | sed 's/[^0-9]//g')
        if [ -z ${NUM} ]; then
            return
        fi
        case ${HOSTNAME} in
            ${A1_HOSTNAME})
            case ${CHAR} in
                'a' | 'A') CHAR=201 ;;
                'b' | 'B') CHAR=203 ;;
                'c' | 'C') CHAR=205 ;;
                'd' | 'D') CHAR=207 ;;
                'e' | 'E') CHAR=209 ;;
                'f' | 'F') CHAR=211 ;;
                'g' | 'G') CHAR=213 ;;
                'h' | 'H') CHAR=215 ;;
                'i' | 'I') CHAR=217 ;;
                'j' | 'J') CHAR=219 ;;
                'k' | 'K') CHAR=221 ;;
                'l' | 'L') CHAR=223 ;;
                'm' | 'M') CHAR=225 ;;
                'n' | 'N') CHAR=227 ;;
                'o' | 'O') CHAR=229 ;;
                'p' | 'P') CHAR=231 ;;
                'q' | 'Q') CHAR=233 ;;
                'r' | 'R') CHAR=235 ;;
                's' | 'S') CHAR=237 ;;
                't' | 'T') CHAR=239 ;;
                'u' | 'U') CHAR=241 ;;
                'v' | 'V') CHAR=243 ;;
                'w' | 'W') CHAR=245 ;;
                *) CHAR=256 ;;
            esac
            case ${PLATFORM} in
                "BMC") echo "192.168.${NUM}.${CHAR}" ;;
                "OS")  echo "192.168.${NUM}.$((${CHAR}-199))" ;;
            esac
            ;;
            ${N2_HOSTNAME})
                if [ ${NUM} -le 12 ]; then
                    case ${CHAR} in
                        'a' | 'A') CHAR=21 ;;
                        'b' | 'B') CHAR=23 ;;
                        'c' | 'C') CHAR=25 ;;
                        'd' | 'D') CHAR=27 ;;
                        'e' | 'E') CHAR=29 ;;
                        'f' | 'F') CHAR=31 ;;
                        'g' | 'G') CHAR=33 ;;
                        'h' | 'H') CHAR=221 ;;
                        'i' | 'I') CHAR=223 ;;
                        'j' | 'J') CHAR=225 ;;
                        'k' | 'K') CHAR=227 ;;
                        'l' | 'L') CHAR=229 ;;
                        'm' | 'M') CHAR=231 ;;
                        *) CHAR=256 ;;
                    esac
                    case ${PLATFORM} in
                        "BMC") echo "192.168.${NUM}.${CHAR}" ;;
                        "OS")  echo "192.168.${NUM}.$((${CHAR}-20))" ;;
                    esac
                elif [ ${NUM} -ge 13 ]; then
                    case ${CHAR} in
                        'a' | 'A') CHAR=25 ;;
                        'b' | 'B') CHAR=27 ;;
                        'c' | 'C') CHAR=29 ;;
                        'd' | 'D') CHAR=31 ;;
                        'e' | 'E') CHAR=33 ;;
                        'f' | 'F') CHAR=35 ;;
                        'g' | 'G') CHAR=37 ;;
                        'h' | 'H') CHAR=39 ;;
                        'i' | 'I') CHAR=41 ;;
                        'j' | 'J') CHAR=43 ;;
                        'k' | 'K') CHAR=45 ;;
                        'l' | 'L') CHAR=47 ;;
                        'm' | 'M') CHAR=225 ;;
                        'n' | 'N') CHAR=227 ;;
                        'o' | 'O') CHAR=229 ;;
                        'p' | 'P') CHAR=231 ;;
                        'q' | 'Q') CHAR=233 ;;
                        'r' | 'R') CHAR=235 ;;
                        's' | 'S') CHAR=237 ;;
                        't' | 'T') CHAR=239 ;;
                        'u' | 'U') CHAR=241 ;;
                        'v' | 'V') CHAR=243 ;;
                        'w' | 'W') CHAR=245 ;;
                        *) CHAR=256 ;;
                    esac
                    case ${PLATFORM} in
                        "BMC") echo "192.168.${NUM}.${CHAR}" ;;
                        "OS")  echo "192.168.${NUM}.$((${CHAR}-24))" ;;
                    esac
                fi
            ;;
        esac
    fi
}

check_ip() {
    local IP=${1}
    ping -c 1 -W 1 ${IP} &> /dev/null
    return ${?}
}

help() {
    printf "IPMI command for Gaines1.5\n"
    printf "bash ipmitool.sh [OPTION]\n"
    printf "OPTION:\n"
    printf "  -h\t--help\n"
    printf "  -v\t--version\n"
    printf "bash ipmitool.sh [BMC_IP/RACK_ID] [CMD]\n"
    printf "ex: get bmc info\n"
    printf "    bash ipmitool.sh 1A 7\n"
    printf "    bash ipmitool.sh 192.168.1.21 7\n"
    printf "    bash ipmitool.sh 192.168.1.21 --bmc_info\n"
    printf "    bash ipmitool.sh 192.168.1.21 mc info\n"
    printf "ex: get rack list\n"
    printf "    bash ipmitool.sh 127.0.0.1 --rack_list\n"
    printf "CMD:\n"
    printf "  %d. power status  \t%s\n" ${POWER_STATUS} "--power_status"
    printf "  %d. power on      \t%s\n" ${POWER_ON} "--power_on"
    printf "  %d. power off     \t%s\n" ${POWER_OFF} "--power_off"
    printf "  %d. power cycle   \t%s\n" ${POWER_CYCLE} "--power_cycle"
    printf "  %d. power reset   \t%s\n" ${POWER_RESET} "--power_reset"
    printf "  %d. serial number \t%s\n" ${SERIAL_NUMBER} "--serial_number"
    printf "  %d. bmc info      \t%s\n" ${BMC_INFO} "--bmc_info"
    printf "  %d. bmc guid      \t%s\n" ${BMC_GUID} "--bmc_guid"
    printf "  %d. bmc reset cold\t%s\n" ${BMC_RESET_COLD} "--bmc_reset_cold"
    printf "  %d. bmc selftest  \t%s\n" ${BMC_SELFTEST} "--bmc_selftest"
    printf "  %d. fru print     \t%s\n" ${FRU_PRINT} "--fru_print <fru_id>"
    printf "  %d. sdr info      \t%s\n" ${SDR_INFO} "--sdr_info"
    printf "  %d. sdr type list \t%s\n" ${SDR_TYPE_LIST} "--sdr_type_list"
    printf "  %d. sdr type type \t%s\n" ${SDR_TYPE_TYPE} "--sdr_type_type [SENSOR_TYPE]"
    printf "  %d. sdr get       \t%s\n" ${SDR_GET} "--sdr_get [SENSOR_ID]"
    printf "  %d. sdr elist     \t%s\n" ${SDR_ELIST} "--sdr_elist <grep string>"
    printf "  %d. sdr list      \t%s\n" ${SDR_LIST} "--sdr_list <grep string>"
    printf "  %d. sensor list   \t%s\n" ${SENSOR_LIST} "--sensor_list <grep string>"
    printf "  %d. sol activate  \t%s\n" ${SOL_ACTIVATE} "--sol_activate"
    printf "  %d. sol deactivate\t%s\n" ${SOL_DEACTIVATE} "--sol_deactivate"
    printf "  %d. lan print     \t%s\n" ${LAN_PRINT} "--lan_print"
    printf "  %d. user list     \t%s\n" ${USER_LIST} "--user_list"
    printf "  %d. sel info      \t%s\n" ${SEL_INFO} "--sel_info"
    printf "  %d. sel elist     \t%s\n" ${SEL_ELIST} "--sel_elist <grep string>"
    printf "  %d. sel get       \t%s\n" ${SEL_GET} "--sel_get [ID]"
    printf "  %d. sel delete    \t%s\n" ${SEL_DELETE} "--sel_delete [ID]"
    printf "  %d. sel clear     \t%s\n" ${SEL_CLEAR} "--sel_clear"
    printf "  %d. sel time get  \t%s\n" ${SEL_TIME_GET} "--sel_time_get"
    printf "  %d. sel time set  \t%s\n" ${SEL_TIME_SET} "--sel_time_set [MM/DD/YYYY HH:MM:SS]"
    printf "  %d. clear sbios   \t%s\n" ${CLEAR_SBIOS} "--clear_sbios"
    printf "  %d. bmc reboot    \t%s\n" ${BMC_REBOOT} "--bmc_reboot"
    printf "  %d. bmc restore   \t%s\n" ${BMC_RESTORE} "--bmc_restore"
    printf "  %d. rack list     \t%s\n" ${RACK_LIST} "--rack_list"
}

version() {
    echo ${VERSION}
}

main() {
    local ALL=${@}
    local OPTION=${1}
    local BMC_IP=${1}
    local RACK_ID=${1}
    local CMD=${2}
    local ARG1=${3}

    case ${OPTION} in
        "-h" | "--help")
        help
        exit 0
        ;;
        "-v" | "--version")
        version
        exit 0
        ;;
    esac

    RACK_IP=$(change_rack_id_to_ip ${RACK_ID} "BMC")
    if [ ! -z ${RACK_IP} ]; then
        BMC_IP=${RACK_IP}
    fi

    check_ip ${BMC_IP}
    if [ ${?} != 0 ]; then
        echo "cannot ping the bmc ip "${BMC_IP}
        exit 1
    else
        case ${CMD} in
            ${POWER_STATUS} | "--power_status")
            base_ipmi ${BMC_IP} "power status"
            ;;
            ${POWER_ON} | "--power_on")
            base_ipmi ${BMC_IP} "power on"
            ;;
            ${POWER_OFF} | "--power_off")
            base_ipmi ${BMC_IP} "power off"
            ;;
            ${POWER_CYCLE} | "--power_cycle")
            base_ipmi ${BMC_IP} "power cycle"
            ;;
            ${POWER_RESET} | "--power_reset")
            base_ipmi ${BMC_IP} "power reset"
            ;;
            ${SERIAL_NUMBER} | "--serial_number")
            serial_number ${BMC_IP}
            ;;
            ${BMC_INFO} | "--bmc_info")
            base_ipmi ${BMC_IP} "mc info"
            ;;
            ${BMC_GUID} | "--bmc_guid")
            base_ipmi ${BMC_IP} "mc guid"
            ;;
            ${BMC_RESET_COLD} | "--bmc_reset_cold")
            base_ipmi ${BMC_IP} "mc reset cold"
            ;;
            ${BMC_SELFTEST} | "--bmc_selftest")
            base_ipmi ${BMC_IP} "mc selftest"
            ;;
            ${FRU_PRINT} | "--fru_print")
            fru_print ${BMC_IP} ${ARG1}
            ;;
            ${SDR_INFO} | "--sdr_info")
            base_ipmi ${BMC_IP} "sdr info"
            ;;
            ${SDR_TYPE_LIST} | "--sdr_type_list")
            base_ipmi ${BMC_IP} "sdr type list"
            ;;
            ${SDR_TYPE_TYPE} | "--sdr_type_type")
            sdr_type_type ${BMC_IP} ${ARG1}
            ;;
            ${SDR_GET} | "--sdr_get")
            sdr_get ${BMC_IP} ${ARG1}
            ;;
            ${SDR_ELIST} | "--sdr_elist")
            sdr_elist ${BMC_IP} ${ARG1}
            ;;
            ${SDR_LIST} | "--sdr_list")
            sdr_list ${BMC_IP} ${ARG1}
            ;;
            ${SENSOR_LIST} | "--sensor_list")
            sensor_list ${BMC_IP} ${ARG1}
            ;;
            ${SOL_ACTIVATE} | "--sol_activate")
            base_ipmi ${BMC_IP} "sol activate"
            ;;
            ${SOL_DEACTIVATE} | "--sol_deactivate")
            base_ipmi ${BMC_IP} "sol deactivate"
            ;;
            ${LAN_PRINT} | "--lan_print")
            base_ipmi ${BMC_IP} "lan print"
            ;;
            ${USER_LIST} | "--user_list")
            base_ipmi ${BMC_IP} "user list"
            ;;
            ${SEL_INFO} | "--sel_info")
            base_ipmi ${BMC_IP} "sel"
            ;;
            ${SEL_ELIST} | "--sel_elist")
            sel_elist ${BMC_IP} ${ARG1}
            ;;
            ${SEL_GET} | "--sel_get")
            sel_get ${BMC_IP} ${ARG1}
            ;;
            ${SEL_DELETE} | "--sel_delete")
            sel_delete ${BMC_IP} ${ARG1}
            ;;
            ${SEL_CLEAR} | "--sel_clear")
            base_ipmi ${BMC_IP} "sel clear"
            ;;
            ${SEL_TIME_GET} | "--sel_time_get")
            base_ipmi ${BMC_IP} "sel time get"
            ;;
            ${SEL_TIME_SET} | "--sel_time_set")
            sel_time_set ${BMC_IP} ${ARG1}
            ;;
            ${CLEAR_SBIOS} | "--clear_sbios")
            base_ipmi ${BMC_IP} "chassis bootdev none clear-cmos=yes"
            ;;
            ${BMC_REBOOT} | "--bmc_reboot")
            base_ipmi ${BMC_IP} "raw 0x6 0x2"
            ;;
            ${BMC_RESTORE} | "--bmc_restore")
            base_ipmi ${BMC_IP} "raw 0x32 0x66"
            ;;
            ${RACK_LIST} | "--rack_list")

            case ${LOCATION} in
               "A1")
               local _RACK_NUM=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30)
               local _RACK_CHAR=('a' 'b' 'c' 'd' 'e' 'f' 'g' 'h' 'i' 'j' 'k' 'l' 'm' 'n' 'o' 'p' 'q' 'r' 's' 't' 'u' 'v' 'w')
               rack_list "_RACK_NUM" "_RACK_CHAR"
               ;;
               "N2")
               local _RACK_NUM=(1 2 3 4 5 6 7 8 9 10 11 12)
               local _RACK_CHAR=('a' 'b' 'c' 'd' 'e' 'f' 'g' 'h' 'i' 'j' 'k' 'l' 'm')
               rack_list "_RACK_NUM" "_RACK_CHAR"
               local __RACK_NUM=(13 14 15 16 17 18 19)
               local __RACK_CHAR=('a' 'b' 'c' 'd' 'e' 'f' 'g' 'h' 'i' 'j' 'k' 'l' 'm' 'n' 'o' 'p' 'q' 'r' 's' 't' 'u' 'v' 'w')
               rack_list "__RACK_NUM" "__RACK_CHAR"
               ;;
            esac

            ;;
            *)
            ipmitool -U admin -P admin -I lanplus -H ${ALL}
            ;;
        esac
    fi
}

if [ ${#} -eq 0 ]; then
    help
    exit 1
fi

main "${@}"
