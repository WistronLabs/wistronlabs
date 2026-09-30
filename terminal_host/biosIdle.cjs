const BIOS_IDLE_MS = 24 * 60 * 60 * 1000;

function parseBiosSessions(output) {
  return output.split("\n").flatMap((line) => {
    const [name, id, created, attached, lastAttached] = line.split("|");
    const mac = /^bs_([a-f0-9]{12})$/.exec(name)?.[1];
    return mac && /^\$\d+$/.test(id) && /^\d+$/.test(created) && /^\d+$/.test(attached) && /^\d+$/.test(lastAttached)
      ? [{ name, id, created, attached: Number(attached), lastAttached: Number(lastAttached) }] : [];
  });
}

function createBiosIdleTracker(timeoutMs = BIOS_IDLE_MS) {
  const detachedSince = new Map();
  return {
    candidates(output, now = Date.now()) {
      const sessions = parseBiosSessions(output);
      const present = new Set(sessions.map(({ id, created }) => `${id}:${created}`));
      for (const id of detachedSince.keys()) if (!present.has(id)) detachedSince.delete(id);
      const due = [];
      for (const session of sessions) {
        const identity = `${session.id}:${session.created}`;
        if (session.attached) {
          detachedSince.delete(identity);
        } else if (!detachedSince.has(identity)) {
          detachedSince.set(identity, { since: now, lastAttached: session.lastAttached });
        } else if (session.lastAttached > detachedSince.get(identity).lastAttached) {
          detachedSince.set(identity, { since: now, lastAttached: session.lastAttached });
        } else if (now - detachedSince.get(identity).since >= timeoutMs) {
          due.push(session);
        }
      }
      return due;
    },
  };
}

module.exports = { BIOS_IDLE_MS, parseBiosSessions, createBiosIdleTracker };
