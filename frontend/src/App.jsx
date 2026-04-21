import React, { useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import ProductList from './pages/ProductList.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Search from './pages/Search.jsx';

export default function App() {
  const [q, setQ] = useState('');
  const nav = useNavigate();

  function submit(e) {
    e.preventDefault();
    nav(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      <nav className="nav">
        <Link to="/"><strong>Slow Shop</strong></Link>
        <Link to="/products">All Products</Link>
        <form onSubmit={submit} style={{ flex: 1, display: 'flex' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products..." />
        </form>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<ProductList />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/search" element={<Search />} />
        </Routes>
      </div>
    </>
  );
}
