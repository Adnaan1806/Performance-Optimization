import React, { useEffect, useState } from 'react';
import { api } from '../api';
import ProductCard from '../components/ProductCard.jsx';

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.home().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p>Error: {error}</p>;
  if (!data) return <p>Loading…</p>;

  const section = (title, items) => (
    <div>
      <h2 className="section-title">{title}</h2>
      <div className="grid">
        {items.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );

  return (
    <>
      {section('Featured', data.featured)}
      {section('New Arrivals', data.newArrivals)}
      {section('Top Rated', data.topRated)}
    </>
  );
}
