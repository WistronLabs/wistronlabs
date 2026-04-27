import { useMemo, useState, useEffect } from "react";
import useApi from "../hooks/useApi";
import useConfirm from "../hooks/useConfirm";

import useToast from "../hooks/useToast";
import AdminTabs from "../components/admin/AdminTabs";
import UsersSection from "../components/admin/sections/UsersSection";
import DpnsSection from "../components/admin/sections/DpnsSection";
import FactoriesSection from "../components/admin/sections/FactoriesSection";
import PartsSection from "../components/admin/sections/PartsSection";
import PartCategoriesSection from "../components/admin/sections/PartCategoriesSection";
import DellCustomersSection from "../components/admin/sections/DellCustomersSection";

function AdminPage() {
  const [tab, setTab] = useState("users");
  const LOCATION = import.meta.env.VITE_LOCATION;

  const {
    getUsers,
    getMe,
    setUserAdmin,
    getDpns,
    createDpn,
    updateDpn,
    deleteDpn,
    getDellCustomers,
    createDellCustomer,
    updateDellCustomer,
    deleteDellCustomer,
    getFactories,
    createFactory,
    updateFactory,
    deleteFactory,
    getParts,
    createPart,
    updatePart,
    deletePart,
    getPartCategories,
    createPartCategory,
    updatePartCategory,
    deletePartCategory,
    getRepairsAllowed,
    updateRepairsAllowed,
  } = useApi();
  const [users, setUsers] = useState([]);
  const [baselineUsers, setBaselineUsers] = useState([]); // snapshot to diff from
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const [dpnQ, setDpnQ] = useState("");

  const { showToast, Toast } = useToast();

  const [dpns, setDpns] = useState([]);
  const [baselineDpns, setBaselineDpns] = useState([]);
  const [dpnLoading, setDpnLoading] = useState(false);
  const [dpnSaving, setDpnSaving] = useState(false);
  const [dpnErr, setDpnErr] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const [dellCustomers, setDellCustomers] = useState([]);
  const [baselineDellCustomers, setBaselineDellCustomers] = useState([]);
  const [dellCustomerLoading, setDellCustomerLoading] = useState(false);
  const [dellCustomerSaving, setDellCustomerSaving] = useState(false);
  const [dellCustomerErr, setDellCustomerErr] = useState(null);
  const [dellCustomerQ, setDellCustomerQ] = useState("");
  const [deletingDellCustomerId, setDeletingDellCustomerId] = useState(null);

  const [factories, setFactories] = useState([]);
  const [baselineFactories, setBaselineFactories] = useState([]);
  const [factoryLoading, setFactoryLoading] = useState(false);
  const [factorySaving, setFactorySaving] = useState(false);
  const [factoryErr, setFactoryErr] = useState(null);
  const [factoryQ, setFactoryQ] = useState("");
  const [deletingFactoryId, setDeletingFactoryId] = useState(null);

  // Parts
  const [parts, setParts] = useState([]);
  const [baselineParts, setBaselineParts] = useState([]);
  const [partLoading, setPartLoading] = useState(false);
  const [partSaving, setPartSaving] = useState(false);
  const [partErr, setPartErr] = useState(null);
  const [partQ, setPartQ] = useState("");
  const [deletingPartId, setDeletingPartId] = useState(null);

  const [partCategories, setPartCategories] = useState([]);

  // Part Categories
  const [partCats, setPartCats] = useState([]);
  const [baselinePartCats, setBaselinePartCats] = useState([]);
  const [partCatLoading, setPartCatLoading] = useState(false);
  const [partCatSaving, setPartCatSaving] = useState(false);
  const [partCatErr, setPartCatErr] = useState(null);
  const [partCatQ, setPartCatQ] = useState("");
  const [deletingPartCatId, setDeletingPartCatId] = useState(null);
  const [repairsAllowed, setRepairsAllowed] = useState(true);
  const [repairsAllowedLoading, setRepairsAllowedLoading] = useState(false);
  const [repairsAllowedSaving, setRepairsAllowedSaving] = useState(false);

  const normalizeDpns = (list = []) =>
    (list || []).map((d) => ({
      ...d,
      dell_customer_ids: Array.isArray(d?.dell_customers)
        ? d.dell_customers.map((c) => c.id)
        : [],
    }));

  // username -> original isAdmin
  const baselineMap = useMemo(() => {
    const m = {};
    for (const u of baselineUsers) m[u.username.toLowerCase()] = !!u.isAdmin;
    return m;
  }, [baselineUsers]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (tab !== "parts") return;
      try {
        if (!partCategories.length) {
          const cats = await getPartCategories();
          if (!alive) return;
          setPartCategories(cats || []);
        }
        if (!baselineParts.length && !partLoading) {
          setPartLoading(true);
          const list = await getParts();
          if (!alive) return;
          setParts(list || []);
          setBaselineParts(list || []);
        }
      } catch (e) {
        if (!alive) return;
        setPartErr(e.message || "Failed to load parts");
      } finally {
        if (alive) {
          setPartLoading(false);
        }
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [tab]);

  useEffect(() => {
    let alive = true;
    const loadPartCats = async () => {
      if (
        tab !== "part-categories" ||
        partCatLoading ||
        baselinePartCats.length
      )
        return;
      try {
        setPartCatLoading(true);
        const list = await getPartCategories();
        if (!alive) return;
        setPartCats(list || []);
        setBaselinePartCats(list || []);
      } catch (e) {
        if (!alive) return;
        setPartCatErr(e.message || "Failed to load part categories");
      } finally {
        if (alive) setPartCatLoading(false);
      }
    };
    loadPartCats();
    return () => {
      alive = false;
    };
  }, [tab]);

  useEffect(() => {
    let alive = true;
    const loadFactories = async () => {
      if (tab !== "factories" || factoryLoading || baselineFactories.length)
        return;
      try {
        setFactoryLoading(true);
        const list = await getFactories(); // expect {id,name,code,ppid_code}
        if (!alive) return;
        setFactories(list || []);
        setBaselineFactories(list || []);
      } catch (e) {
        if (!alive) return;
        setFactoryErr(e.message || "Failed to load factories");
      } finally {
        if (alive) setFactoryLoading(false);
      }
    };
    loadFactories();
    return () => {
      alive = false;
    };
  }, [tab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [meRes, listRes] = await Promise.all([
          getMe(),
          getUsers({ page: 1, page_size: 100 }),
        ]);
        if (!alive) return;
        const meUser = meRes?.user ?? null;
        const list = listRes?.users ?? [];
        setMe(meUser);
        setUsers(list);
        setBaselineUsers(list);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to load users");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // ← run once

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setRepairsAllowedLoading(true);
        const res = await getRepairsAllowed();
        if (!alive) return;
        setRepairsAllowed(!!res?.repairs_allowed);
      } catch (e) {
        if (!alive) return;
        console.error("Failed to load repairs_allowed:", e);
      } finally {
        if (alive) setRepairsAllowedLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadDpns = async () => {
      if (tab !== "dpns" || dpnLoading || baselineDpns.length) return;
      try {
        setDpnLoading(true);
        const list = await getDpns(); // expect array of { id, name, config }
        if (!alive) return;
        const normalized = normalizeDpns(list || []);
        setDpns(normalized);
        setBaselineDpns(normalized);
      } catch (e) {
        if (!alive) return;
        setDpnErr(e.message || "Failed to load DPNs");
      } finally {
        if (alive) setDpnLoading(false);
      }
    };
    loadDpns();
    return () => {
      alive = false;
    };
  }, [tab]); // run when switching to DPNs

  useEffect(() => {
    let alive = true;
    const shouldLoad =
      tab === "dell-customers" || tab === "dpns";
    const haveBaseline = baselineDellCustomers.length > 0;
    if (!shouldLoad || dellCustomerLoading || haveBaseline) return;

    (async () => {
      try {
        setDellCustomerLoading(true);
        const list = await getDellCustomers();
        if (!alive) return;
        setDellCustomers(list || []);
        setBaselineDellCustomers(list || []);
      } catch (e) {
        if (!alive) return;
        setDellCustomerErr(e.message || "Failed to load Dell customers");
      } finally {
        if (alive) setDellCustomerLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [tab]);

  const partCatBaselineMap = useMemo(() => {
    const m = new Map();
    baselinePartCats.forEach((c) => m.set(c.id, { name: c.name }));
    return m;
  }, [baselinePartCats]);

  const filteredPartCats = useMemo(() => {
    const q = partCatQ.trim().toLowerCase();
    if (!q) return partCats;
    return partCats.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [partCats, partCatQ]);

  const partCatHasChanges = useMemo(() => {
    return partCats.some((c) => {
      if (typeof c.id !== "number") return !!c.name?.trim();
      const base = partCatBaselineMap.get(c.id);
      return base && base.name !== c.name;
    });
  }, [partCats, partCatBaselineMap]);

  const dpnBaselineMap = useMemo(() => {
    const m = new Map();
    baselineDpns.forEach((d) =>
      m.set(d.id, {
        name: d.name,
        config: d.config ?? "",
        dell_customer:
          (Array.isArray(d.dell_customers) && d.dell_customers[0]?.name) || "",
        dell_customer_ids: Array.isArray(d.dell_customers)
          ? d.dell_customers.map((c) => c.id).sort((a, b) => a - b)
          : [],
      })
    );
    return m;
  }, [baselineDpns]);

  const filteredDpns = useMemo(() => {
    const q = dpnQ.trim().toLowerCase();
    if (!q) return dpns;
    return dpns.filter(
      (d) =>
        (d.name || "").toLowerCase().includes(q) ||
        (d.config || "").toLowerCase().includes(q) ||
        (Array.isArray(d.dell_customers)
          ? d.dell_customers.some((c) =>
              String(c?.name || "").toLowerCase().includes(q),
            )
          : false)
    );
  }, [dpns, dpnQ]);

  const dpnHasChanges = useMemo(() => {
    return dpns.some((d) => {
      if (typeof d.id !== "number") {
        return (
          d.name?.trim() ||
          d.config?.trim() ||
          (Array.isArray(d.dell_customer_ids) && d.dell_customer_ids.length > 0)
        );
      }
      const base = dpnBaselineMap.get(d.id);
      return (
        base &&
        (base.name !== d.name ||
          (base.config ?? "") !== (d.config ?? "") ||
          JSON.stringify(base.dell_customer_ids || []) !==
            JSON.stringify(
              (Array.isArray(d.dell_customer_ids) ? d.dell_customer_ids : []).slice().sort((a, b) => a - b),
            ))
      );
    });
  }, [dpns, dpnBaselineMap]);

  const factoryBaselineMap = useMemo(() => {
    const m = new Map();
    baselineFactories.forEach((f) =>
      m.set(f.id, {
        name: f.name,
        code: f.code,
        ppid_code: f.ppid_code ?? "",
      })
    );
    return m;
  }, [baselineFactories]);

  const filteredFactories = useMemo(() => {
    const q = factoryQ.trim().toLowerCase();
    if (!q) return factories;
    return factories.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.code.toLowerCase().includes(q) ||
        (f.ppid_code || "").toLowerCase().includes(q)
    );
  }, [factories, factoryQ]);

  const factoryHasChanges = useMemo(() => {
    return factories.some((f) => {
      if (typeof f.id !== "number") {
        return f.name?.trim() || f.code?.trim() || f.ppid_code?.trim();
      }
      const base = factoryBaselineMap.get(f.id);
      return (
        base &&
        (base.name !== f.name ||
          base.code !== f.code ||
          (base.ppid_code ?? "") !== (f.ppid_code ?? ""))
      );
    });
  }, [factories, factoryBaselineMap]);

  const partBaselineMap = useMemo(() => {
    const m = new Map();
    baselineParts.forEach((p) =>
      m.set(String(p.id), {
        name: p.name,
        dpn: p.dpn ?? "",
        part_category_id: p.part_category_id ?? null,
      })
    );
    return m;
  }, [baselineParts]);

  const filteredParts = useMemo(() => {
    const q = partQ.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.dpn || "").toLowerCase().includes(q),
    );
  }, [parts, partQ]);

  const partHasChanges = useMemo(() => {
    return parts.some((p) => {
      if (typeof p.id === "string" && p.id.startsWith("new-")) {
        return !!p.name?.trim() || p.part_category_id != null;
      }
      const base = partBaselineMap.get(String(p.id));
      return (
        base &&
        (base.name !== p.name ||
          base.dpn !== p.dpn ||
          (base.part_category_id ?? null) !== (p.part_category_id ?? null))
      );
    });
  }, [parts, partBaselineMap]);
  const addBlankPartRow = () => {
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setParts((cur) => [{ id: newId, name: "" }, ...cur]);
  };

  const onPartCellNameChange = (id, value) => {
    setParts((cur) =>
      cur.map((p) => (p.id === id ? { ...p, name: value } : p))
    );
  };

  const onPartCellDPNChange = (id, value) => {
    setParts((cur) => cur.map((p) => (p.id === id ? { ...p, dpn: value } : p)));
  };

  const onPartDiscard = () => {
    setParts(baselineParts);
    setPartErr(null);
  };

  const onPartSave = async (e) => {
    e.preventDefault();
    setPartErr(null);
    if (!partHasChanges) return;

    setPartSaving(true);
    try {
      const isTemp = (id) => typeof id === "string" && id.startsWith("new-");

      // New rows: now consider dpn as well
      const newRows = parts.filter(
        (p) =>
          isTemp(p.id) &&
          ((p.name && p.name.trim()) ||
            (p.dpn && p.dpn.trim()) ||
            p.part_category_id != null)
      );

      // Changed rows: detect name, dpn, and category changes
      const changedRows = parts.filter((p) => {
        if (isTemp(p.id)) return false;
        const base = partBaselineMap.get(String(p.id));
        if (!base) return false;

        return (
          (base.name || "") !== (p.name || "") ||
          (base.dpn || "") !== (p.dpn || "") ||
          (base.part_category_id ?? null) !== (p.part_category_id ?? null)
        );
      });

      // --- Create new parts ---
      for (const row of newRows) {
        const nameSan = (row.name || "").trim().toUpperCase();
        const dpnSan = (row.dpn || "").trim().toUpperCase();

        if (!nameSan) throw new Error("Part name is required");
        if (!dpnSan) throw new Error("DPN is required");

        const payload = {
          name: nameSan,
          dpn: dpnSan,
          part_category_id: row.part_category_id || null,
        };

        await createPart(payload);
      }

      // --- Update existing parts ---
      for (const row of changedRows) {
        const base = partBaselineMap.get(String(row.id));
        const nameSan = (row.name || "").trim().toUpperCase();
        const dpnSan = (row.dpn || "").trim().toUpperCase();

        if (!nameSan) throw new Error("Part name is required");
        if (!dpnSan) throw new Error("DPN is required");

        const payload = {};

        if (nameSan !== (base.name || "")) {
          payload.name = nameSan;
        }
        if (dpnSan !== (base.dpn || "")) {
          payload.dpn = dpnSan;
        }
        if (
          (row.part_category_id ?? null) !== (base.part_category_id ?? null)
        ) {
          payload.part_category_id = row.part_category_id || null;
        }

        if (Object.keys(payload).length) {
          await updatePart(row.id, payload);
        }
      }

      const fresh = await getParts();
      setParts(fresh || []);
      setBaselineParts(fresh || []);
      showToast("Parts saved", "success", 2200, "bottom-right");
    } catch (e2) {
      console.error("Saving parts failed:", e2);
      setPartErr(e2.message || "Failed to save parts");
      showToast("Failed to save parts", "error", 3000, "bottom-right");
    } finally {
      setPartSaving(false);
    }
  };

  const handleDeletePart = async (row) => {
    if (typeof row.id !== "number") {
      setParts((cur) => cur.filter((p) => p.id !== row.id));
      return;
    }
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Delete part "${row.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }
    try {
      setDeletingPartId(row.id);
      await deletePart(row.id);
      setParts((cur) => cur.filter((p) => p.id !== row.id));
      setBaselineParts((cur) => cur.filter((p) => p.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg = e?.body?.error || e?.message || "Failed to delete part";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingPartId(null);
    }
  };

  const sanitizeFactoryField = (s = "") => s.trim().toUpperCase();

  const addBlankFactoryRow = () => {
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setFactories((cur) => [
      { id: newId, name: "", code: "", ppid_code: "" },
      ...cur,
    ]);
  };

  const onFactoryCellChange = (id, field, value) => {
    setFactories((cur) =>
      cur.map((f) => (f.id === id ? { ...f, [field]: value } : f))
    );
  };

  const onFactoryDiscard = () => {
    setFactories(baselineFactories);
    setFactoryErr(null);
  };

  const onFactorySave = async (e) => {
    e.preventDefault();
    setFactoryErr(null);
    if (!factoryHasChanges) return;
    setFactorySaving(true);
    try {
      const newRows = factories.filter(
        (f) => typeof f.id !== "number" && (f.name?.trim() || f.code?.trim())
      );
      const changedRows = factories.filter((f) => {
        if (typeof f.id !== "number") return false;
        const base = factoryBaselineMap.get(f.id);
        return (
          base &&
          (base.name !== f.name ||
            base.code !== f.code ||
            (base.ppid_code ?? "") !== (f.ppid_code ?? ""))
        );
      });

      for (const row of newRows) {
        await createFactory({
          name: sanitizeFactoryField(row.name),
          code: sanitizeFactoryField(row.code),
          ppid_code: row.ppid_code.trim(),
        });
      }

      for (const row of changedRows) {
        const base = factoryBaselineMap.get(row.id);
        const payload = {};
        const nameSan = sanitizeFactoryField(row.name);
        const codeSan = sanitizeFactoryField(row.code);
        const ppidSan = row.ppid_code.trim();
        if (nameSan !== base.name) payload.name = nameSan;
        if (codeSan !== base.code) payload.code = codeSan;
        if (ppidSan !== base.ppid_code) payload.ppid_code = ppidSan;
        if (Object.keys(payload).length > 0) {
          await updateFactory(row.id, payload);
        }
      }

      const fresh = await getFactories();
      setFactories(fresh || []);
      setBaselineFactories(fresh || []);
      showToast("Factories saved", "success", 2500, "bottom-right");
    } catch (e2) {
      console.error("Saving factories failed:", e2);
      setFactoryErr(e2.message || "Failed to save factories");
      showToast("Failed to save factories", "error", 3000, "bottom-right");
    } finally {
      setFactorySaving(false);
    }
  };

  const handleDeleteFactory = async (row) => {
    if (typeof row.id !== "number") {
      setFactories((cur) => cur.filter((f) => f.id !== row.id));
      return;
    }
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Are you sure you want to delete factory ${row.name}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }
    try {
      setDeletingFactoryId(row.id);
      await deleteFactory(row.id);
      setFactories((cur) => cur.filter((f) => f.id !== row.id));
      setBaselineFactories((cur) => cur.filter((f) => f.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg =
        e?.body?.error ||
        (e?.status === 409
          ? "Cannot delete factory: referenced by pallets or systems"
          : e?.message) ||
        "Failed to delete factory";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingFactoryId(null);
    }
  };

  const sanitizeName = (s) => ((s ?? "") + "").trim().toUpperCase();
  const sanitizeConfig = (s) => ((s ?? "") + "").trim().toUpperCase();
  const sanitizeCustomer = (s) => ((s ?? "") + "").trim();
  const getCustomerNameById = (id) =>
    sanitizeCustomer(
      (dellCustomers || []).find((c) => Number(c.id) === Number(id))?.name || "",
    );

  const validateRow = (row) => {
    const name = sanitizeName(row.name);
    if (!name) return "DPN name is required";
    // optional: length/format checks here
    return null;
  };

  const addBlankRow = () => {
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setDpns((cur) => [
      { id: newId, name: "", config: "", dell_customer_ids: [] },
      ...cur,
    ]);
  };

  const onCellChange = (id, field, value) => {
    setDpns((cur) =>
      cur.map((d) => {
        if (d.id !== id) return d;
        return { ...d, [field]: value };
      }),
    );
  };

  const onToggleDpnDellCustomer = (dpnId, customerId) => {
    setDpns((cur) =>
      cur.map((d) => {
        if (d.id !== dpnId) return d;
        const ids = new Set(Array.isArray(d.dell_customer_ids) ? d.dell_customer_ids : []);
        if (ids.has(customerId)) ids.delete(customerId);
        else ids.add(customerId);
        return { ...d, dell_customer_ids: [...ids] };
      }),
    );
  };

  const onDpnDiscard = () => {
    setDpns(baselineDpns);
    setDpnErr(null);
  };

  const onDpnSave = async (e) => {
    e.preventDefault();
    setDpnErr(null);
    if (!dpnHasChanges) return;

    setDpnSaving(true);
    try {
      // Separate new vs changed
      const newRows = dpns.filter(
        (d) => typeof d.id !== "number" && (d.name?.trim() || d.config?.trim())
      );
      const changedRows = dpns.filter((d) => {
        if (typeof d.id !== "number") return false;
        const base = dpnBaselineMap.get(d.id);
        return (
          base &&
          (base.name !== d.name ||
            (base.config ?? "") !== (d.config ?? "") ||
            JSON.stringify(base.dell_customer_ids || []) !==
              JSON.stringify(
                (Array.isArray(d.dell_customer_ids) ? d.dell_customer_ids : []).slice().sort((a, b) => a - b),
              ))
        );
      });

      // NEW rows
      for (const row of newRows) {
        const name = sanitizeName(row.name);
        const config = sanitizeConfig(row.config);
        const dell_customer_ids = (Array.isArray(row.dell_customer_ids)
          ? row.dell_customer_ids
          : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0);
        const dell_customer = getCustomerNameById(dell_customer_ids[0]);
        const errMsg = validateRow({ name, config });
        if (errMsg) throw new Error(`Row "${row.name || "(new)"}": ${errMsg}`);
        if (!dell_customer_ids.length || !dell_customer) {
          throw new Error(
            `Row "${row.name || "(new)"}": Select at least one allowed Dell customer`,
          );
        }
        await createDpn({ name, config, dell_customer_ids });
      }

      // CHANGED rows
      for (const row of changedRows) {
        const base = dpnBaselineMap.get(row.id);
        const payload = {};
        const nameSan = sanitizeName(row.name);
        const configSan = sanitizeConfig(row.config);
        const idsSan = (Array.isArray(row.dell_customer_ids) ? row.dell_customer_ids : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0);
        const customerSan = getCustomerNameById(idsSan[0]);
        if (!idsSan.length || !customerSan) {
          throw new Error(`Row "${row.name}": Select at least one allowed Dell customer`);
        }
        if (nameSan !== base.name) payload.name = nameSan;
        if ((configSan ?? "") !== (base.config ?? ""))
          payload.config = configSan;
        if (
          JSON.stringify((idsSan || []).slice().sort((a, b) => a - b)) !==
          JSON.stringify((base.dell_customer_ids || []).slice().sort((a, b) => a - b))
        ) {
          payload.dell_customer_ids = idsSan;
        }
        if (Object.keys(payload).length > 0) {
          await updateDpn(row.id, payload);
        }
      }

      // Refresh list to get authoritative data (and new ids)
      const fresh = await getDpns();
      const normalized = normalizeDpns(fresh || []);
      setDpns(normalized);
      setBaselineDpns(normalized);
      showToast("DPNs saved", "success", 2500, "bottom-right");
    } catch (e2) {
      console.error("Saving DPNs failed:", e2);
      setDpnErr(e2.message || "Failed to save DPNs");
      showToast("Failed to save DPNs", "error", 3000, "bottom-right");
    } finally {
      setDpnSaving(false);
    }
  };

  const handleDeleteDpn = async (row) => {
    // If it's a local "new" row (id not a number), just remove it from UI.
    if (typeof row.id !== "number") {
      setDpns((cur) => cur.filter((d) => d.id !== row.id));
      return;
    }

    // Confirm, then call delete
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Are you sure you want to delete ${row.name}? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }

    try {
      setDeletingId(row.id);
      await deleteDpn(row.id);
      // remove from current and baseline lists
      setDpns((cur) => cur.filter((d) => d.id !== row.id));
      setBaselineDpns((cur) => cur.filter((d) => d.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg =
        (e?.body && e.body.error) ||
        (e?.status === 409
          ? "Cannot delete DPN: referenced by systems or pallets"
          : e?.message) ||
        "Failed to delete DPN";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingId(null);
    }
  };

  // Local-only toggle (no PATCH here)
  const handleLocalToggle = (u, nextChecked) => {
    setErr(null);
    const isSelf = me?.username?.toLowerCase() === u.username?.toLowerCase();

    if (!me?.isAdmin) {
      setErr("Admin privileges required.");
      return;
    }
    if (isSelf && nextChecked === false) {
      setErr("You cannot remove your own admin role.");
      return;
    }

    setUsers((cur) =>
      cur.map((x) =>
        x.username === u.username ? { ...x, isAdmin: nextChecked } : x
      )
    );
  };

  // Compute pending changes (diff current vs baseline)
  const pendingChanges = useMemo(() => {
    const changes = [];
    for (const u of users) {
      const orig = baselineMap[u.username.toLowerCase()];
      const cur = !!u.isAdmin;
      if (orig !== cur) {
        changes.push({ username: u.username, admin: cur });
      }
    }
    return changes;
  }, [users, baselineMap]);

  const hasChanges = pendingChanges.length > 0;

  const handleSave = async (e) => {
    e.preventDefault(); // prevent page reload
    setErr(null);

    if (!me?.isAdmin) {
      setErr("Admin privileges required.");
      return;
    }

    // Block self de-admin if somehow present in pending
    const self = pendingChanges.find(
      (c) => c.username.toLowerCase() === me.username.toLowerCase()
    );
    if (self && self.admin === false) {
      setErr("You cannot remove your own admin role.");
      return;
    }

    if (!hasChanges) return;

    setSaving(true);
    try {
      // Loop over single-user PATCH endpoint (sequential for easier error handling)
      for (const c of pendingChanges) {
        await setUserAdmin(c.username, c.admin);
      }
      // On success, reset baseline to current
      setBaselineUsers(users);
    } catch (e2) {
      console.error("Saving admin changes failed:", e2);
      setErr(e2.message || "Failed to save changes");
      // Optional: reload list to ensure UI matches server
      try {
        const listRes = await getUsers({ page: 1, page_size: 100 });
        setUsers(listRes?.users ?? []);
        setBaselineUsers(listRes?.users ?? []);
      } catch (reloadErr) {
        console.error("Reload users failed:", reloadErr);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = (e) => {
    e.preventDefault();
    setUsers(baselineUsers); // revert local edits
    setErr(null);
  };
  const sanitizePartCatName = (s = "") => s.trim().toUpperCase();

  const addBlankPartCatRow = () => {
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setPartCats((cur) => [{ id: newId, name: "" }, ...cur]);
  };

  const onPartCatCellChange = (id, value) => {
    setPartCats((cur) =>
      cur.map((c) => (c.id === id ? { ...c, name: value } : c))
    );
  };

  const onPartCatDiscard = () => {
    setPartCats(baselinePartCats);
    setPartCatErr(null);
  };

  const onPartCatSave = async (e) => {
    e.preventDefault();
    setPartCatErr(null);
    if (!partCatHasChanges) return;

    setPartCatSaving(true);
    try {
      const newRows = partCats.filter(
        (c) => typeof c.id !== "number" && c.name?.trim()
      );
      const changedRows = partCats.filter((c) => {
        if (typeof c.id !== "number") return false;
        const base = partCatBaselineMap.get(c.id);
        return base && base.name !== c.name;
      });

      for (const row of newRows) {
        const name = sanitizePartCatName(row.name);
        if (!name)
          throw new Error(`Row "${row.name || "(new)"}": Name required`);
        await createPartCategory({ name });
      }

      for (const row of changedRows) {
        const base = partCatBaselineMap.get(row.id);
        const nameSan = sanitizePartCatName(row.name);
        if (nameSan !== base.name) {
          await updatePartCategory(row.id, { name: nameSan });
        }
      }

      const fresh = await getPartCategories();
      setPartCats(fresh || []);
      setBaselinePartCats(fresh || []);
      showToast("Part categories saved", "success", 2200, "bottom-right");
    } catch (e2) {
      console.error("Saving part categories failed:", e2);
      setPartCatErr(
        e2?.body?.error || e2.message || "Failed to save part categories"
      );
      showToast(
        "Failed to save part categories",
        "error",
        3000,
        "bottom-right"
      );
    } finally {
      setPartCatSaving(false);
    }
  };

  const handleDeletePartCategory = async (row) => {
    if (typeof row.id !== "number") {
      setPartCats((cur) => cur.filter((c) => c.id !== row.id));
      return;
    }

    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Delete category "${row.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }

    try {
      setDeletingPartCatId(row.id);
      await deletePartCategory(row.id);
      setPartCats((cur) => cur.filter((c) => c.id !== row.id));
      setBaselinePartCats((cur) => cur.filter((c) => c.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg =
        e?.body?.error ||
        (e?.status === 409
          ? "Cannot delete category: referenced by parts"
          : e?.message) ||
        "Failed to delete category";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingPartCatId(null);
    }
  };

  const dellCustomerBaselineMap = useMemo(() => {
    const m = new Map();
    baselineDellCustomers.forEach((c) => m.set(c.id, { name: c.name }));
    return m;
  }, [baselineDellCustomers]);

  const filteredDellCustomers = useMemo(() => {
    const q = dellCustomerQ.trim().toLowerCase();
    if (!q) return dellCustomers;
    return dellCustomers.filter((c) =>
      String(c?.name || "").toLowerCase().includes(q),
    );
  }, [dellCustomers, dellCustomerQ]);

  const dellCustomerHasChanges = useMemo(() => {
    return dellCustomers.some((c) => {
      if (typeof c.id !== "number") return !!String(c.name || "").trim();
      const base = dellCustomerBaselineMap.get(c.id);
      return base && base.name !== c.name;
    });
  }, [dellCustomers, dellCustomerBaselineMap]);

  const addBlankDellCustomerRow = () => {
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setDellCustomers((cur) => [{ id: newId, name: "" }, ...cur]);
  };

  const onDellCustomerCellChange = (id, value) => {
    setDellCustomers((cur) =>
      cur.map((c) => (c.id === id ? { ...c, name: value } : c)),
    );
  };

  const onDellCustomerDiscard = () => {
    setDellCustomers(baselineDellCustomers);
    setDellCustomerErr(null);
  };

  const onDellCustomerSave = async (e) => {
    e.preventDefault();
    setDellCustomerErr(null);
    if (!dellCustomerHasChanges) return;

    setDellCustomerSaving(true);
    try {
      const newRows = dellCustomers.filter(
        (c) => typeof c.id !== "number" && String(c.name || "").trim(),
      );
      const changedRows = dellCustomers.filter((c) => {
        if (typeof c.id !== "number") return false;
        const base = dellCustomerBaselineMap.get(c.id);
        return base && base.name !== c.name;
      });

      for (const row of newRows) {
        const name = String(row.name || "").trim();
        if (!name) throw new Error("Dell customer name is required");
        await createDellCustomer({ name });
      }
      for (const row of changedRows) {
        const name = String(row.name || "").trim();
        if (!name) throw new Error("Dell customer name is required");
        await updateDellCustomer(row.id, { name });
      }

      const fresh = await getDellCustomers();
      setDellCustomers(fresh || []);
      setBaselineDellCustomers(fresh || []);
      showToast("Dell customers saved", "success", 2200, "bottom-right");
    } catch (e2) {
      console.error("Saving Dell customers failed:", e2);
      setDellCustomerErr(e2?.body?.error || e2.message || "Failed to save Dell customers");
      showToast("Failed to save Dell customers", "error", 3000, "bottom-right");
    } finally {
      setDellCustomerSaving(false);
    }
  };

  const handleDeleteDellCustomer = async (row) => {
    if (typeof row.id !== "number") {
      setDellCustomers((cur) => cur.filter((c) => c.id !== row.id));
      return;
    }
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Delete Dell customer "${row.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }
    try {
      setDeletingDellCustomerId(row.id);
      await deleteDellCustomer(row.id);
      setDellCustomers((cur) => cur.filter((c) => c.id !== row.id));
      setBaselineDellCustomers((cur) => cur.filter((c) => c.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg = e?.body?.error || e?.message || "Failed to delete Dell customer";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingDellCustomerId(null);
    }
  };

  const handleRepairsAllowedToggle = async () => {
    const nextValue = !repairsAllowed;
    const confirmed = await confirm({
      title: nextValue ? "Enable Repairs" : "Disable Repairs",
      message: nextValue
        ? "Enable repair intake across the app?"
        : "Disable repair intake across the app? This setting will be stored globally.",
      confirmText: nextValue ? "Enable" : "Disable",
      cancelText: "Cancel",
      confirmClass: nextValue
        ? "bg-green-600 text-white hover:bg-green-700"
        : "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) return;

    try {
      setRepairsAllowedSaving(true);
      const res = await updateRepairsAllowed(nextValue);
      setRepairsAllowed(!!res?.repairs_allowed);
      showToast(
        `Repairs ${res?.repairs_allowed ? "enabled" : "disabled"}`,
        "success",
        2200,
        "bottom-right",
      );
    } catch (e) {
      showToast(
        e?.body?.error || e?.message || "Failed to update repairs setting",
        "error",
        3200,
        "bottom-right",
      );
    } finally {
      setRepairsAllowedSaving(false);
    }
  };

  return (
    <>
      <Toast />
      <ConfirmDialog />

      <main className="mx-auto mt-10 w-11/12 md:w-10/12 max-w-screen-xl bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">Admin</h1>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Repairs Allowed
              </div>
              <p className="mt-1 text-sm text-gray-700">
                Global setting for repair intake. Changes here affect the entire
                app.
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-amber-700">
                {repairsAllowedLoading
                  ? "Loading current state..."
                  : repairsAllowed
                    ? "Currently enabled"
                    : "Currently disabled"}
              </p>
            </div>

            <button
              type="button"
              disabled={repairsAllowedLoading || repairsAllowedSaving}
              onClick={handleRepairsAllowedToggle}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white shadow transition disabled:opacity-50 ${
                repairsAllowed
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {repairsAllowedSaving
                ? "Saving..."
                : repairsAllowed
                  ? "Disable Repairs"
                  : "Enable Repairs"}
            </button>
          </div>
        </section>

        <AdminTabs tab={tab} setTab={setTab} />

        {tab === "users" && (
          <UsersSection
            err={err}
            loading={loading}
            users={users}
            baselineMap={baselineMap}
            me={me}
            showToast={showToast}
            handleLocalToggle={handleLocalToggle}
            handleDiscard={handleDiscard}
            handleSave={handleSave}
            hasChanges={hasChanges}
            saving={saving}
          />
        )}
        {tab === "dell-customers" && (
          <DellCustomersSection
            onSave={onDellCustomerSave}
            addBlankRow={addBlankDellCustomerRow}
            query={dellCustomerQ}
            setQuery={setDellCustomerQ}
            error={dellCustomerErr}
            loading={dellCustomerLoading}
            rows={filteredDellCustomers}
            baselineMap={dellCustomerBaselineMap}
            onCellChange={onDellCustomerCellChange}
            onDelete={handleDeleteDellCustomer}
            deletingId={deletingDellCustomerId}
            saving={dellCustomerSaving}
            onDiscard={onDellCustomerDiscard}
            hasChanges={dellCustomerHasChanges}
          />
        )}

        {tab === "dpns" && (
          <DpnsSection
            onDpnSave={onDpnSave}
            addBlankRow={addBlankRow}
            dpnQ={dpnQ}
            setDpnQ={setDpnQ}
            dpnErr={dpnErr}
            dpnLoading={dpnLoading}
            filteredDpns={filteredDpns}
            dpnBaselineMap={dpnBaselineMap}
            onCellChange={onCellChange}
            onToggleDellCustomer={onToggleDpnDellCustomer}
            dellCustomers={dellCustomers}
            handleDeleteDpn={handleDeleteDpn}
            deletingId={deletingId}
            dpnSaving={dpnSaving}
            onDpnDiscard={onDpnDiscard}
            dpnHasChanges={dpnHasChanges}
          />
        )}
        {tab === "factories" && (
          <FactoriesSection
            onFactorySave={onFactorySave}
            addBlankFactoryRow={addBlankFactoryRow}
            factoryQ={factoryQ}
            setFactoryQ={setFactoryQ}
            factoryErr={factoryErr}
            factoryLoading={factoryLoading}
            filteredFactories={filteredFactories}
            factoryBaselineMap={factoryBaselineMap}
            onFactoryCellChange={onFactoryCellChange}
            handleDeleteFactory={handleDeleteFactory}
            deletingFactoryId={deletingFactoryId}
            factorySaving={factorySaving}
            onFactoryDiscard={onFactoryDiscard}
            factoryHasChanges={factoryHasChanges}
          />
        )}
        {tab === "parts" && (
          <PartsSection
            onPartSave={onPartSave}
            addBlankPartRow={addBlankPartRow}
            partQ={partQ}
            setPartQ={setPartQ}
            partErr={partErr}
            partLoading={partLoading}
            filteredParts={filteredParts}
            partBaselineMap={partBaselineMap}
            onPartCellNameChange={onPartCellNameChange}
            onPartCellDPNChange={onPartCellDPNChange}
            setParts={setParts}
            partCategories={partCategories}
            handleDeletePart={handleDeletePart}
            deletingPartId={deletingPartId}
            partSaving={partSaving}
            onPartDiscard={onPartDiscard}
            partHasChanges={partHasChanges}
          />
        )}
        {tab === "part-categories" && (
          <PartCategoriesSection
            onPartCatSave={onPartCatSave}
            addBlankPartCatRow={addBlankPartCatRow}
            partCatQ={partCatQ}
            setPartCatQ={setPartCatQ}
            partCatErr={partCatErr}
            partCatLoading={partCatLoading}
            filteredPartCats={filteredPartCats}
            partCatBaselineMap={partCatBaselineMap}
            onPartCatCellChange={onPartCatCellChange}
            handleDeletePartCategory={handleDeletePartCategory}
            deletingPartCatId={deletingPartCatId}
            partCatSaving={partCatSaving}
            onPartCatDiscard={onPartCatDiscard}
            partCatHasChanges={partCatHasChanges}
          />
        )}
      </main>
    </>
  );
}

export default AdminPage;
