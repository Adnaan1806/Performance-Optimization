const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function json(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const api = {
  home: () => json('/home'),
  products: (page = 1, limit = 20) => json(`/products?page=${page}&limit=${limit}`),
  product: (id) => json(`/products/${id}`),
  search: (q) => json(`/search?q=${encodeURIComponent(q)}`),
  imageUrl: (path) => `${BASE}/images/${path}`,
};
