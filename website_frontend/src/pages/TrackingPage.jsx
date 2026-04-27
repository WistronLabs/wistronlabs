import React, { useContext, useState, useEffect, useCallback } from "react";
import SearchContainerSS from "../components/SearchContainerSS.jsx";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import SystemInOutChart from "../components/SystemInOutChart.jsx";
import SystemLocationsChart from "../components/SystemLocationsChart.jsx";
import { DateTime } from "luxon";

import { AuthContext } from "../context/AuthContext.jsx";

import { pdf } from "@react-pdf/renderer";
import SystemPDFLabel from "../components/SystemPDFLabel.jsx";

import AddSystemModal from "../components/AddSystemModal.jsx";
import DownloadReportModal from "../components/DownloadReportModal.jsx";
import BatchExportSystemFilesModal from "../components/BatchExportSystemFilesModal.jsx";
import Tooltip from "../components/Tooltip.jsx";

import { formatDateHumanReadable } from "../utils/date_format.js";
import { downloadCSV } from "../utils/csv.js";
import { delay } from "../utils/delay.js";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast";
import useIsMobile from "../hooks/useIsMobile.jsx";
import useApi from "../hooks/useApi.jsx";
import { useSystemsFetch } from "../hooks/useSystemsFetch.jsx";
import { useHistoryFetch } from "../hooks/useHistoryFetch.jsx";

function TrackingPage() {
  const FRONTEND_URL = import.meta.env.VITE_URL;
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [locations, setLocations] = useState([]);
  const [InOutChartHistory, setInOutChartHistory] = useState([]);
  const [locationChartHistory, setLocationChartHistory] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const [showActive, setShowActive] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [addSystemFormError, setAddSystemFormError] = useState(null);
  const [idiotProof, setIdiotProof] = useState(false);
  const printFriendly = true;
  const [dellCustomers, setDellCustomers] = useState([]);
  const [dpnCatalog, setDpnCatalog] = useState([]);
  const [factories, setFactories] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [customTags, setCustomTags] = useState([]);
  const [showBulkReenterModal, setShowBulkReenterModal] = useState(false);
  const [bulkInactiveCandidates, setBulkInactiveCandidates] = useState([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkStoppedTag, setBulkStoppedTag] = useState(null);
  const [bulkRetryWarning, setBulkRetryWarning] = useState(null);
  const [isBatchExportModalOpen, setIsBatchExportModalOpen] = useState(false);
  const [batchExportCsv, setBatchExportCsv] = useState("");
  const [batchExportPreview, setBatchExportPreview] = useState(null);
  const [batchExports, setBatchExports] = useState([]);
  const [batchExportsLoading, setBatchExportsLoading] = useState(false);
  const [batchExportPreviewLoading, setBatchExportPreviewLoading] = useState(false);
  const [batchExportStartLoading, setBatchExportStartLoading] = useState(false);
  const [activeBatchExportJobId, setActiveBatchExportJobId] = useState(null);
  const [chartDays, setChartDays] = useState(7);
  const [chartDaysInput, setChartDaysInput] = useState("7");

  const [serverTime, setServerTime] = useState([]);

  const [reportMode, setReportMode] = useState("perday");

  const { token } = useContext(AuthContext);

  const fetchSystems = useSystemsFetch();
  const fetchHistory = useHistoryFetch();

  const activeLocationIDs = [1, 2, 3, 4, 5];
  const systemLocationChartIDs = [1, 2, 3, 4, 5];
  const inactiveLocationIDs = [6, 7, 8, 9, 10];

  const {
    getDpns,
    getLocations,
    getFactories,
    getHistory,
    createSystem,
    moveSystemToReceived,
    getServerTime,
    getSnapshot,
    getSystemHistory,
    getSystem,
    getTags,
    updateHostMac,
    updateBmcMac,
    updateSystemDellCustomer,
    previewBatchExportUnitData,
    createBatchExportUnitData,
  } = useApi();

  const fetchData = async () => {
    setLoading(true);

    try {
      const [locationsData, serverTimeData, dpnsData, factoriesData, tagsData] =
        await Promise.all([
          getLocations(),
          getServerTime(),
          getDpns(),
          getFactories(),
          getTags(),
        ]);

      const activeLocationNames = locationsData
        .filter((loc) => activeLocationIDs.includes(loc.id))
        .map((loc) => loc.name);

      // Base time in server’s local timezone
      const serverLocalNow = DateTime.fromFormat(
        serverTimeData.localtime,
        "MM/dd/yyyy, hh:mm:ss a",
        { zone: serverTimeData.zone },
      );

      let activeLocationSnapshotFirstDay,
        historyData,
        historyBeginningDateTime = null;

      //for (let daysBack = chartDays - 1; daysBack >= 0; daysBack--) {
      const snapshotDate = serverLocalNow
        .minus({ days: chartDays - 1 })
        .set({ hour: 23, minute: 59, second: 59, millisecond: 59 })
        .toUTC()
        .toISO();

      historyBeginningDateTime = serverLocalNow
        .minus({ days: chartDays - 1 })
        .set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      const historyBeginningDateISO = historyBeginningDateTime.toUTC().toISO();

      [activeLocationSnapshotFirstDay, historyData] = await Promise.all([
        getSnapshot({
          date: snapshotDate,
          locations: activeLocationNames,
          simplified: idiotProof,
        }),
        fetchHistory({
          all: true,
          filters: {
            op: "AND",
            conditions: [
              {
                field: "changed_at",
                values: [historyBeginningDateISO],
                op: ">=",
              },
            ],
          },
        }).then((res) => res.data),
      ]);

      //   if (
      //     activeLocationSnapshotFirstDay &&
      //     activeLocationSnapshotFirstDay.length > 0
      //   ) {
      //     break;
      //   }
      // }

      // cutoff for Location Chart: *one day after historyBeginningDateTime*
      const locationChartHistoryCutoffDateTime = historyBeginningDateTime
        .plus({
          days: 1,
        })
        .toUTC()
        .toISO();

      const filteredHistory = historyData.filter((h) => {
        const dt = DateTime.fromISO(h.changed_at, { zone: "utc" }).toISO();
        return dt >= locationChartHistoryCutoffDateTime;
      });
      setLocations(locationsData);
      setInOutChartHistory(historyData);
      setLocationChartHistory(filteredHistory);
      setServerTime(serverTimeData);
      setSnapshot(activeLocationSnapshotFirstDay);
      setDellCustomers(
        dpnsData
          .flatMap((d) =>
            Array.isArray(d?.dell_customers)
              ? d.dell_customers.map((c) => String(c?.name || "").trim())
              : [],
          )
          .filter((d, i, self) => d && i === self.indexOf(d)),
      );
      setDpnCatalog(dpnsData || []);
      setFactories(factoriesData.map((f) => f.code));
      setConfigs([...new Set(dpnsData.map(x => x.config))].filter(x => x).sort());
      setCustomTags(tagsData.map((t) => t.code));
    } catch (err) {
      setError(err.message);
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [idiotProof, chartDays]);

  useEffect(() => {
    setChartDaysInput(String(chartDays));
  }, [chartDays]);

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();

  const fetchBatchExports = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setBatchExportsLoading(true);
    }
    try {
      const res = await fetch(`${BACKEND_URL}/systems/batch-export-unit-data`);
      if (!res.ok) {
        throw new Error(`Batch export list failed: ${res.status}`);
      }
      const data = await res.json();
      setBatchExports(data || []);
    } catch (err) {
      console.error("Failed to load batch exports", err);
    } finally {
      if (showLoading) {
        setBatchExportsLoading(false);
      }
    }
  }, [BACKEND_URL]);

  useEffect(() => {
    if (!isBatchExportModalOpen) return undefined;

    fetchBatchExports({ showLoading: true });
    const interval = setInterval(() => {
      fetchBatchExports({ showLoading: false });
    }, 5000);
    return () => clearInterval(interval);
  }, [isBatchExportModalOpen, fetchBatchExports]);

  const getDpnFromPpid = (ppidRaw) =>
    String(ppidRaw || "")
      .trim()
      .toUpperCase()
      .slice(3, 8);

  const getAllowedDellCustomersForDpn = (dpnName) => {
    const dpnEntry = (dpnCatalog || []).find(
      (d) => String(d?.name || "").trim().toUpperCase() === String(dpnName || "").trim().toUpperCase(),
    );
    if (!dpnEntry) return null;
    const mapped = Array.isArray(dpnEntry.dell_customers)
      ? dpnEntry.dell_customers
          .map((c) => String(c?.name || "").trim())
          .filter(Boolean)
      : [];
    return [...new Set(mapped)];
  };

  const buildReviewRows = (parsedRows, activeByTag, inactiveByTag) =>
    parsedRows.map((row) => {
      const serviceTag = String(row.rawTag || "").trim().toUpperCase();
      const dpnName = getDpnFromPpid(row.ppid);
      const options = getAllowedDellCustomersForDpn(dpnName);

      let rowType = activeByTag.has(serviceTag)
        ? "active"
        : inactiveByTag.has(serviceTag)
          ? "inactive"
          : "new";
      let skipReason = "";
      if (rowType !== "active") {
        if (!options) {
          rowType = "skip";
          skipReason = "No DPN match - skipped";
        } else if (options.length === 0) {
          rowType = "skip";
          skipReason = "No Dell customer configured - skipped";
        }
      }

      const activeSystem = activeByTag.get(serviceTag);
      const activeCustomer = String(activeSystem?.dell_customer || "").trim();
      const selectedCustomer = rowType === "active"
        ? activeCustomer
        : options && options.length === 1
          ? options[0]
          : "";

      return {
        ...row,
        service_tag: serviceTag,
        ppid: String(row.ppid || "").trim().toUpperCase(),
        row_type: rowType,
        skip_reason: skipReason,
        confirmed: false,
        dpn: dpnName,
        dell_customer_options: options || [],
        selected_dell_customer: selectedCustomer,
      };
    });

  async function addOrUpdateSystem(
    service_tag,
    issue,
    ppid,
    rack_service_tag,
    host_mac,
    bmc_mac,
    dell_customer,
    options = {},
  ) {
    const { inactiveByTag = null, askConfirmInactive = true } = options;

    let inactiveSystems = [];
    if (!inactiveByTag) {
      const response = await fetchSystems({
        page_size: 150,
        inactive: true,
        active: false,
        sort_by: "location",
        sort_order: "desc",
        all: true,
        serverZone: serverTime.zone,
      });
      inactiveSystems = response?.data || [];
    }

    const payload = {
      service_tag,
      issue,
      location_id: 1, // "Received"
      ppid,
      rack_service_tag,
      host_mac,
      bmc_mac,
      dell_customer,
    };

    const normalizedTag = String(service_tag || "").trim().toUpperCase();
    const inactive = inactiveByTag
      ? !!inactiveByTag.get(normalizedTag)
      : inactiveSystems.some(
          (sys) =>
            String(sys.service_tag || "").trim().toUpperCase() === normalizedTag,
        );

    try {
      if (inactive) {
        if (askConfirmInactive) {
          const confirmed = await confirm({
            title: "Re-enter System?",
            message: `${service_tag} exists as inactive. Move it back to Received?`,
            confirmText: "Confirm",
            cancelText: "Cancel",
          });
          if (!confirmed) {
            showToast(`Skipped ${service_tag}`, "error", 3000, "top-right");
            return null;
          }
        }

        await moveSystemToReceived(service_tag, issue, rack_service_tag);

        // if the system already exists, set/refresh MACs here so you don't rely on old/missing values
        await updateHostMac(service_tag, host_mac);
        await updateBmcMac(service_tag, bmc_mac);
        await updateSystemDellCustomer(service_tag, dell_customer);

        showToast(
          `${service_tag} moved back to received`,
          "success",
          3000,
          "top-right",
        );
      } else {
        await createSystem(payload);
      }

      const sysFull = await getSystem(service_tag);

      return {
        service_tag,
        issue: sysFull?.issue ?? issue ?? "",
        dpn: sysFull?.dpn ?? "",
        config: sysFull?.config ?? "",
        dell_customer: sysFull?.dell_customer ?? "",
        url: `${FRONTEND_URL}${service_tag}`,
        _operation: inactive ? "rereceived" : "added",
      };
    } catch (err) {
      console.error(err);

      const rawMsg = err?.body?.error || err?.message || "Unknown error";
      const msg = String(rawMsg)
        .replace(/\s*\(this unit is already in the system\)\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      return msg;
    }
  }

  function resetBulkReviewState() {
    setShowBulkReenterModal(false);
    setBulkInactiveCandidates([]);
    setBulkStoppedTag(null);
    setBulkRetryWarning(null);
    setBulkProcessing(false);
  }

  function closeAddSystemModal() {
    setShowModal(false);
    setAddSystemFormError(null);
    resetBulkReviewState();
  }

  function toggleBulkReviewTag(serviceTag) {
    setBulkInactiveCandidates((prev) =>
      prev.map((row) =>
        row.service_tag === serviceTag && row.row_type === "inactive"
          ? { ...row, confirmed: !row.confirmed }
          : row,
      ),
    );
  }

  function toggleBulkReviewAllInactive() {
    setBulkInactiveCandidates((prev) => {
      const inactiveRows = prev.filter((r) => r.row_type === "inactive");
      const allConfirmed =
        inactiveRows.length > 0 && inactiveRows.every((r) => r.confirmed);
      return prev.map((row) =>
        row.row_type === "inactive"
          ? { ...row, confirmed: !allConfirmed }
          : row,
      );
    });
  }

  function setBulkReviewDellCustomer(serviceTag, customerName) {
    setBulkInactiveCandidates((prev) =>
      prev.map((row) =>
        row.service_tag === serviceTag
          ? { ...row, selected_dell_customer: customerName }
          : row,
      ),
    );
  }

  async function handleBulkReviewReceive() {
    if (bulkStoppedTag) {
      closeAddSystemModal();
      return;
    }
    if (bulkProcessing || bulkInactiveCandidates.length === 0) return;

    setBulkProcessing(true);
    setBulkStoppedTag(null);
    setAddSystemFormError(null);

    let addOrUpdateSystemError = false;
    const systemsPDF = [];
    let addedCount = 0;
    let rereceivedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const failedRows = [];
    const inactiveByTag = new Map(
      bulkInactiveCandidates
        .filter((row) => row.row_type === "inactive")
        .map((row) => [row.service_tag, true]),
    );
    const activeTagSet = new Set(
      bulkInactiveCandidates
        .filter((row) => row.row_type === "active")
        .map((row) => row.service_tag),
    );
    const confirmedInactiveTags = new Set(
      bulkInactiveCandidates
        .filter((row) => row.row_type === "inactive" && row.confirmed)
        .map((row) => row.service_tag),
    );

    try {
      for (const row of bulkInactiveCandidates) {
        const tag = row.service_tag;

        if (activeTagSet.has(tag)) {
          skippedCount += 1;
          continue;
        }
        if (row.row_type === "skip") {
          skippedCount += 1;
          continue;
        }
        if (row.row_type === "inactive" && !confirmedInactiveTags.has(tag)) {
          skippedCount += 1;
          continue;
        }
        if (
          Array.isArray(row.dell_customer_options) &&
          row.dell_customer_options.length > 1 &&
          !String(row.selected_dell_customer || "").trim()
        ) {
          skippedCount += 1;
          continue;
        }

        let printable = null;
        try {
          printable = await addOrUpdateSystem(
            tag,
            row.issue,
            row.ppid,
            row.rackServiceTag,
            row.host12,
            row.bmc12,
            row.selected_dell_customer,
            { inactiveByTag, askConfirmInactive: false },
          );
        } catch (err) {
          console.error("Error processing line:", tag, err);
          failedCount += 1;
          failedRows.push(`${tag}: ${err?.message || "Unknown error"}`);
          continue;
        }

        if (printable?.service_tag) {
          systemsPDF.push(printable);
          if (printable?._operation === "rereceived") rereceivedCount += 1;
          else addedCount += 1;
        } else if (printable) {
          failedCount += 1;
          failedRows.push(`${tag}: ${printable}`);
          setBulkStoppedTag(tag);
          setAddSystemFormError(`Stopped processing at ${tag}: ${printable}`);
          setBulkRetryWarning(
            `Previous run stopped at ${tag}.`,
          );
          addOrUpdateSystemError = true;
          break;
        } else {
          skippedCount += 1;
        }
      }

      if (systemsPDF.length > 0) {
        await delay(500);
        try {
          const blob = await pdf(
            <SystemPDFLabel systems={systemsPDF} />,
          ).toBlob();
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (err) {
          console.error("Failed to generate PDF", err);
        }
      }

      await fetchData();
      const successCount = addedCount + rereceivedCount;
      const summary = `Added ${addedCount}, Re-received ${rereceivedCount}, Skipped ${skippedCount}, Failed ${failedCount}`;

      if (successCount === 0) {
        showToast(`No units were added. ${summary}`, "error", 4500, "top-right");
      } else if (failedCount > 0) {
        const failPreview = failedRows.slice(0, 2).join(" | ");
        showToast(
          `${summary}${failPreview ? ` — ${failPreview}` : ""}`,
          "error",
          5000,
          "top-right",
        );
      } else {
        showToast(summary, "success", 3500, "top-right");
      }

      if (!addOrUpdateSystemError) {
        closeAddSystemModal();
      }
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleAddSystemSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    const isMac12Hex = (s) =>
      /^[0-9A-F]{12}$/.test(
        String(s ?? "")
          .trim()
          .toUpperCase(),
      );

    if (!bulkMode) {
      // ---------- SINGLE ADD ----------
      const service_tag = formData.get("service_tag")?.trim().toUpperCase();
      const issue = formData.get("issue")?.trim() || null;
      const ppid = formData.get("ppid")?.trim().toUpperCase();
      const rack_service_tag = formData.get("rack_service_tag")?.trim();
      const host_mac = formData.get("host_mac")?.trim().toUpperCase();
      const bmc_mac = formData.get("bmc_mac")?.trim().toUpperCase();

      if (
        !service_tag ||
        !ppid ||
        !issue ||
        !rack_service_tag ||
        !host_mac ||
        !bmc_mac
      ) {
        setAddSystemFormError("All fields are required.");
        return;
      }
      if (service_tag.length !== 7) {
        setAddSystemFormError("Service Tag must be exactly 7 characters.");
        return;
      }

      if (!isMac12Hex(host_mac)) {
        setAddSystemFormError(
          "Host MAC must be exactly 12 hex characters (A1B2C3D4E5F6).",
        );
        return;
      }
      if (!isMac12Hex(bmc_mac)) {
        setAddSystemFormError(
          "BMC MAC must be exactly 12 hex characters (A1B2C3D4E5F6).",
        );
        return;
      }

      if (issue.length > 50) {
        setAddSystemFormError(
          `Please keep issue field under 50 characters (current: ${issue.length})`,
        );
        return;
      }

      setAddSystemFormError(null);
      const [inactiveResp, activeResp] = await Promise.all([
        fetchSystems({
          page_size: 150,
          inactive: true,
          active: false,
          sort_by: "location",
          sort_order: "desc",
          all: true,
          serverZone: serverTime.zone,
        }),
        fetchSystems({
          page_size: 150,
          inactive: false,
          active: true,
          sort_by: "location",
          sort_order: "desc",
          all: true,
          serverZone: serverTime.zone,
        }),
      ]);
      const inactiveByTag = new Map(
        (inactiveResp?.data || []).map((sys) => [
          String(sys.service_tag || "").trim().toUpperCase(),
          true,
        ]),
      );
      const activeByTag = new Map(
        (activeResp?.data || []).map((sys) => [
          String(sys.service_tag || "").trim().toUpperCase(),
          sys,
        ]),
      );

      const singleRows = buildReviewRows(
        [
          {
            rawTag: service_tag,
            issue,
            ppid,
            rackServiceTag: rack_service_tag,
            host12: host_mac,
            bmc12: bmc_mac,
          },
        ],
        activeByTag,
        inactiveByTag,
      );
      const singleRow = singleRows[0];

      const needsReview =
        singleRow.row_type === "inactive" ||
        singleRow.row_type === "active" ||
        singleRow.row_type === "skip" ||
        singleRow.dell_customer_options.length > 1;

      if (needsReview) {
        setBulkStoppedTag(null);
        setBulkInactiveCandidates(singleRows);
        setShowBulkReenterModal(true);
        return;
      }

      const printable = await addOrUpdateSystem(
        service_tag,
        issue,
        ppid,
        rack_service_tag,
        host_mac,
        bmc_mac,
        singleRow.selected_dell_customer,
        { inactiveByTag, askConfirmInactive: false },
      );

      // ---------- PDF for single ----------
      if (printable?.service_tag) {
        await delay(500);
        try {
          const blob = await pdf(
            <SystemPDFLabel systems={[printable]} />,
          ).toBlob();

          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (err) {
          console.error("Failed to generate PDF", err);
        }
        setTimeout(
          () =>
            showToast("Successfully added unit", "success", 3000, "top-right"),
          3000,
        );
      } else if (printable) {
        setAddSystemFormError(printable);
        console.log("TEST");
        return;
      }
      closeAddSystemModal();
      await fetchData();
    } else {
      // ---------- BULK ADD ----------
      const csv = formData.get("bulk_csv")?.trim();
      if (!csv) {
        setAddSystemFormError("Please provide CSV data for bulk import.");
        return;
      }
      setBulkRetryWarning(null);
      setAddSystemFormError(null);

      // Pre-validate
      const rawLines = csv.split(/\r?\n/).map((l) => l.trim());
      const lines = rawLines.filter((l) => l.length > 0);

      const longIssues = [];
      const badLines = [];
      const badMacLines = [];
      const badServiceTagLines = [];

      const parsed = lines.map((line, idx) => {
        const parts = line.split(/\t|,/).map((s) => (s ?? "").trim());

        // Expect exactly 6 non-empty fields:
        // service_tag, issue, ppid, rack_service_tag, host_mac, bmc_mac
        const [rawTag, issue, ppid, hostMac, bmcMac, rackServiceTag] = parts;

        const ok =
          parts.length === 6 &&
          rawTag &&
          issue &&
          ppid &&
          rackServiceTag &&
          hostMac &&
          bmcMac;

        if (!ok) badLines.push(idx + 1);
        if (rawTag && String(rawTag).trim().toUpperCase().length !== 7) {
          badServiceTagLines.push(idx + 1);
        }

        if (issue?.length > 50) longIssues.push(idx + 1);

        const host12 = String(hostMac ?? "")
          .trim()
          .toUpperCase();
        const bmc12 = String(bmcMac ?? "")
          .trim()
          .toUpperCase();

        if (ok && (!isMac12Hex(host12) || !isMac12Hex(bmc12))) {
          badMacLines.push(idx + 1);
        }

        return { rawTag, issue, ppid, rackServiceTag, host12, bmc12 };
      });

      if (badLines.length > 0) {
        setAddSystemFormError(
          `Bulk import error: lines missing required 6 fields → ${badLines.join(", ")}`,
        );
        return;
      }
      if (longIssues.length > 0) {
        setAddSystemFormError(
          `Issue error: issues on lines exceed 50 characters → ${longIssues.join(", ")}`,
        );
        return;
      }
      if (badMacLines.length > 0) {
        setAddSystemFormError(
          `MAC error: lines must include host_mac and bmc_mac as 12 hex chars → ${badMacLines.join(", ")}`,
        );
        return;
      }
      if (badServiceTagLines.length > 0) {
        setAddSystemFormError(
          `Service Tag error: must be exactly 7 characters on lines → ${badServiceTagLines.join(", ")}`,
        );
        return;
      }

      const [inactiveResp, activeResp] = await Promise.all([
        fetchSystems({
          page_size: 150,
          inactive: true,
          active: false,
          sort_by: "location",
          sort_order: "desc",
          all: true,
          serverZone: serverTime.zone,
        }),
        fetchSystems({
          page_size: 150,
          inactive: false,
          active: true,
          sort_by: "location",
          sort_order: "desc",
          all: true,
          serverZone: serverTime.zone,
        }),
      ]);

      const inactiveByTag = new Map(
        (inactiveResp?.data || []).map((sys) => [
          String(sys.service_tag || "").trim().toUpperCase(),
          true,
        ]),
      );
      const activeByTag = new Map(
        (activeResp?.data || []).map((sys) => [
          String(sys.service_tag || "").trim().toUpperCase(),
          sys,
        ]),
      );

      const reviewRows = buildReviewRows(parsed, activeByTag, inactiveByTag);

      setBulkStoppedTag(null);
      setBulkInactiveCandidates(reviewRows);
      setShowBulkReenterModal(true);
    }
  }

  // // Create a snapshot of the latest state for each service_tag on each date
  // // This will be used for the report download

  async function handleDownloadReport() {
    if (!reportDate) {
      showToast(`Select a Date`, "error", 3000, "top-right");
      return;
    }

    try {
      const serverTimeReport = await getServerTime();
      const serverZone = serverTimeReport.zone;

      const serverLocal = DateTime.fromISO(reportDate, { zone: serverZone });
      const reportDT = serverLocal
        .set({ hour: 23, minute: 59, second: 59, millisecond: 0 })
        .toUTC()
        .toISO();

      const startOfDayUTC = serverLocal.startOf("day").toUTC().toISO();

      const params = new URLSearchParams({
        date: reportDT,
        includeNote: "true",
        noCache: "true",
        mode: reportMode,
        includeReceived: "true",
        format: "csv",
        timezone: serverZone,
      });

      if (reportMode !== "cumulative") {
        params.set("start", startOfDayUTC);
      }

      // NEW: pass simplified flag
      if (idiotProof) params.set("simplified", "true");

      const resp = await fetch(
        `${BACKEND_URL}/systems/snapshot?${params.toString()}`,
      );
      if (!resp.ok) throw new Error(await resp.text());

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapshot_${reportDate}_${reportMode}${
        idiotProof ? "_simplified" : ""
      }.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast(
        `Report for ${reportDate} downloading`,
        "success",
        3000,
        "top-right",
      );
    } catch (err) {
      console.error("Failed to generate report", err);
      showToast("Failed to generate report", "error", 3000, "top-right");
    }
  }

  async function handleBatchExportPreview() {
    if (!batchExportCsv.trim()) {
      showToast("Paste at least one service tag", "error", 3000, "top-right");
      return;
    }

    setBatchExportPreviewLoading(true);
    try {
      const data = await previewBatchExportUnitData(batchExportCsv);
      setBatchExportPreview(data);
    } catch (err) {
      console.error("Failed to preview batch export", err);
      showToast(
        err?.body?.error || err?.message || "Failed to preview batch export",
        "error",
        3500,
        "top-right",
      );
    } finally {
      setBatchExportPreviewLoading(false);
    }
  }

  async function handleStartBatchExport() {
    if (!batchExportPreview) {
      showToast("Review the batch export first", "error", 3000, "top-right");
      return;
    }

    if (!batchExportPreview.will_export?.length) {
      showToast("No valid systems available for export", "error", 3500, "top-right");
      return;
    }

    setBatchExportStartLoading(true);
    try {
      const job = await createBatchExportUnitData(batchExportCsv);
      setActiveBatchExportJobId(job?.job_id || null);
      setBatchExportPreview(null);
      setBatchExportCsv("");
      await fetchBatchExports({ showLoading: false });
      showToast("Batch export started", "success", 3000, "top-right");
    } catch (err) {
      console.error("Failed to start batch export", err);
      showToast(
        err?.body?.error || err?.message || "Failed to start batch export",
        "error",
        3500,
        "top-right",
      );
    } finally {
      setBatchExportStartLoading(false);
    }
  }

  async function handleDownloadBatchExport(job) {
    try {
      const url = `${BACKEND_URL}/systems/batch-export-unit-data/${encodeURIComponent(job.job_id)}/download`;
      const a = document.createElement("a");
      a.href = url;
      a.download = job.file_name || `${job.job_id}.tgz`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("Batch export downloading", "success", 3000, "top-right");
    } catch (err) {
      console.error("Failed to download batch export", err);
      showToast(
        err?.body?.error || err?.message || "Failed to download batch export",
        "error",
        3500,
        "top-right",
      );
    }
  }

  const fetchSystemsWithFlags = useCallback(
    (options) => {
      return fetchSystems({
        ...options,
        active: showActive,
        inactive: showInactive,
        serverZone: serverTime.zone,
      });
    },
    [showActive, showInactive, serverTime],
  );

  return (
    <>
      <ConfirmDialog />
      <Toast />

      <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-semibold text-gray-800">Systems</h1>
          <Tooltip
            text="Please log in to add a unit"
            position="botom"
            show={!token == true}
          >
            {token && (
              <button
                onClick={() => {
                  resetBulkReviewState();
                  setAddSystemFormError(null);
                  setShowModal(true);
                }}
                className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-s ${
                  !token ? "opacity-30 pointer-events-none" : ""
                }`}
              >
                + Add System
              </button>
            )}
          </Tooltip>
        </div>

        {loading ? (
          <LoadingSkeleton rows={10} />
        ) : error ? (
          <div className="text-red-600">{error}</div>
        ) : (
          <>
            <SystemLocationsChart
              snapshot={snapshot}
              history={locationChartHistory}
              locations={locations}
              activeLocationIDs={systemLocationChartIDs}
              serverTime={serverTime}
              chartDays={chartDays}
              printFriendly={printFriendly}
            />
            <SystemInOutChart
              history={InOutChartHistory}
              locations={locations}
              activeLocationIDs={activeLocationIDs}
              serverTime={serverTime}
              chartDays={chartDays}
              printFriendly={printFriendly}
            />

            <div className="flex flex-wrap justify-end items-center gap-4 mt-2">
              <label className="inline-flex items-center gap-2 text-xs text-gray-500">
                Days
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={chartDaysInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, "");
                    setChartDaysInput(raw);
                  }}
                  onBlur={() => {
                    const raw = String(chartDaysInput || "").trim();
                    if (!raw) {
                      setChartDaysInput(String(chartDays));
                      return;
                    }
                    const parsed = Number.parseInt(raw, 10);
                    if (!Number.isFinite(parsed)) {
                      setChartDaysInput(String(chartDays));
                      return;
                    }
                    const next = Math.min(60, Math.max(1, parsed));
                    setChartDays(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const raw = String(chartDaysInput || "").trim();
                    if (!raw) {
                      setChartDaysInput(String(chartDays));
                      return;
                    }
                    const parsed = Number.parseInt(raw, 10);
                    if (!Number.isFinite(parsed)) {
                      setChartDaysInput(String(chartDays));
                      return;
                    }
                    const next = Math.min(60, Math.max(1, parsed));
                    setChartDays(next);
                  }}
                  className="w-16 border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <div className="flex justify-end gap-4 mt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showActive}
                  onChange={() => {
                    if (showInactive || !showActive) {
                      setShowActive(!showActive);
                      setPage(1);
                    }
                  }}
                  className="accent-blue-600"
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={() => {
                    if (showActive || !showInactive) {
                      setShowInactive(!showInactive);
                      setPage(1);
                    }
                  }}
                  className="accent-blue-600"
                />
                Inactive
              </label>
            </div>
            <SearchContainerSS
              page={page}
              onPageChange={(newPage) => setPage(newPage)}
              persistStateKey="tracking-systems"
              title=""
              fetchData={fetchSystemsWithFlags}
              displayOrder={[
                "service_tag",
                "issue",
                "location",
                "date_created",
                "date_modified",
              ]}
              defaultSortBy="date_modified"
              defaultSortAsc={false}
              fieldStyles={{
                service_tag: "text-blue-600 font-medium",
                date_created: "text-gray-500 text-sm",
                date_last_modified: "text-gray-500 text-sm",
                location: (val) =>
                  [
                    "Sent to L11",
                    "Sent for Dell Repair",
                    "RMA CID",
                    "RMA VID",
                    "RMA PID",
                  ].includes(val)
                    ? { type: "pill", color: "bg-green-100 text-green-800" }
                    : ["Received", "In Debug - Wistron", "In L10"].includes(val)
                      ? { type: "pill", color: "bg-red-100 text-red-800" }
                      : {
                          type: "pill",
                          color: "bg-yellow-100 text-yellow-800",
                        },
              }}
              linkType="internal"
              truncate={true}
              visibleFields={
                isMobile
                  ? ["service_tag", "issue", "location"]
                  : [
                      "service_tag",
                      "issue",
                      "location",
                      "date_created",
                      "date_modified",
                    ]
              }
              possibleSearchTags={[
                ...locations.map((l) => ({ field: "location", value: l.name })),
                ...configs.map(c => ({field: "config", value: c})),
                ...dellCustomers.map((d) => ({
                  field: "dell_customer",
                  value: d,
                })),
                ...factories.map((f) => ({ field: "factory", value: f })),
                ...customTags.map((t) => ({ field: "tags", value: t })),
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Download Report
              </button>
              <button
                onClick={() => setIsBatchExportModalOpen(true)}
                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Batch Export System Files
              </button>
            </div>
          </>
        )}
        {showModal && (
          <AddSystemModal
            onClose={closeAddSystemModal}
            bulkMode={bulkMode}
            setBulkMode={setBulkMode}
            onSubmit={handleAddSystemSubmit}
            addSystemFormError={addSystemFormError}
            hidden={false}
            showBulkReview={showBulkReenterModal}
            bulkReviewRows={bulkInactiveCandidates}
            bulkReviewStoppedTag={bulkStoppedTag}
            bulkReviewProcessing={bulkProcessing}
            bulkRetryWarning={bulkRetryWarning}
            onBulkReviewToggleTag={toggleBulkReviewTag}
            onBulkReviewToggleAll={toggleBulkReviewAllInactive}
            onBulkReviewCustomerChange={setBulkReviewDellCustomer}
            onBulkReviewBack={() => {
              setShowBulkReenterModal(false);
              setAddSystemFormError(null);
            }}
            onBulkReviewSubmit={handleBulkReviewReceive}
          />
        )}
        {isModalOpen && (
          <DownloadReportModal
            onClose={() => setIsModalOpen(false)}
            reportDate={reportDate}
            setReportDate={setReportDate}
            onDownload={handleDownloadReport}
            reportMode={reportMode}
            setReportMode={setReportMode}
            idiotProof={idiotProof}
            setIdiotProof={setIdiotProof}
          />
        )}
        {isBatchExportModalOpen && (
          <BatchExportSystemFilesModal
            onClose={() => {
              setIsBatchExportModalOpen(false);
              setBatchExportPreview(null);
            }}
            canCreateBatchExport={!!token}
            csvText={batchExportCsv}
            setCsvText={setBatchExportCsv}
            onPreview={handleBatchExportPreview}
            onBackToEdit={() => setBatchExportPreview(null)}
            previewLoading={batchExportPreviewLoading}
            previewData={batchExportPreview}
            onStart={handleStartBatchExport}
            startLoading={batchExportStartLoading}
            jobs={batchExports}
            jobsLoading={batchExportsLoading}
            onDownload={handleDownloadBatchExport}
            activeJobId={activeBatchExportJobId}
          />
        )}
      </main>
    </>
  );
}

export default TrackingPage;
