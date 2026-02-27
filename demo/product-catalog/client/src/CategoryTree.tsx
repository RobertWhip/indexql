import { useState, useEffect } from 'react';

interface Category {
  id: string;
  name: string;
  slug: string;
  children: { id: string; name: string; slug: string }[];
}

interface Props {
  selectedSlug: string | null;
  onSelect: (slug: string, categoryId: string) => void;
}

export function CategoryTree({ selectedSlug, onSelect }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/products/categories')
      .then(r => r.json())
      .then(setCategories)
      .catch(err => console.error('Failed to load categories:', err));
  }, []);

  function toggleExpand(slug: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <div>
      {categories.map(parent => (
        <div key={parent.id}>
          <button
            onClick={() => toggleExpand(parent.slug)}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
              color: '#333',
            }}
          >
            {expanded.has(parent.slug) ? '▼' : '▶'} {parent.name}
            <span style={{ color: '#999', fontWeight: 400, marginLeft: 6 }}>
              ({parent.children.length})
            </span>
          </button>

          {expanded.has(parent.slug) && (
            <div style={{ paddingLeft: 20 }}>
              {parent.children.map(child => (
                <button
                  key={child.id}
                  onClick={() => onSelect(child.slug, child.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '5px 12px',
                    background: selectedSlug === child.slug ? '#e8f0fe' : 'none',
                    border: 'none',
                    borderLeft: selectedSlug === child.slug ? '3px solid #1a73e8' : '3px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: selectedSlug === child.slug ? '#1a73e8' : '#555',
                  }}
                >
                  {child.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
