import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard.jsx';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) return;
    setData(null);
    api.search(q).then(setData).catch((e) => setError(e.message));
  }, [q]);

  if (!q) return <p>Type something in the search box.</p>;
  if (error) return <p>Error: {error}</p>;
  if (!data) return <p>Searching…</p>;

  return (
    <>
      <h2 className="section-title">Results for "{q}" ({data.count})</h2>
      <div className="grid">
        {data.results.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </>
  );
}
