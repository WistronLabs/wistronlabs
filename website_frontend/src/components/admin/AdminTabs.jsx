function AdminTabs({ tab, setTab, isSuperAdmin }) {
  const tabs = [
    { key: "users", label: "Users" },
    ...(isSuperAdmin ? [{ key: 'account-access', label: 'Account Access' }] : []),
    { key: "dell-customers", label: "Dell Customers" },
    { key: "dpns", label: "DPNs" },
    { key: "factories", label: "Factories" },
    { key: "parts", label: "Parts" },
    { key: "part-categories", label: "Part Categories" },
  ];

  return (
    <div className="flex gap-4 mt-2 border-b border-gray-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
            tab === t.key
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default AdminTabs;
