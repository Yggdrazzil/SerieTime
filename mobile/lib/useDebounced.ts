import { useEffect, useState } from 'react';

// Retourne la valeur après un délai de stabilité — évite une requête par frappe
// dans les champs de recherche.
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
