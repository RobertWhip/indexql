# IndexQL Demos

## Demo Apps

| Demo | Description |
|------|-------------|
| [product-catalog](./product-catalog/) | Full-stack e-commerce catalog. PostgreSQL seeds 80k products, Express builds binary artifacts per subcategory on demand, React client decodes and queries locally with faceted filtering. |

## Use Case Ideas

1. **Real estate listing search** — Encode property listings (price, sqft, bedrooms, lot size) into binary artifacts. Buyers get instant faceted filtering by price range, neighborhood, and property type without hitting the server on every filter change.

2. **Job board** — Compile job postings into static artifacts served from a CDN. Candidates filter by salary range, location, experience level, and skills entirely client-side.

3. **Restaurant/food discovery** — Encode menus and venue metadata (cuisine type, price tier, rating, dietary tags). Users browse and filter offline-capable on mobile.

4. **Flight/hotel search results** — After an initial API search, encode results into IndexQL binary. All subsequent filter/sort operations (stops, airline, price range, departure time) happen locally with sub-ms latency.

5. **Library/bookstore catalog** — Encode book metadata (author, genre, publication year, page count, language). Patrons get instant faceted search without backend round-trips.

6. **Vehicle inventory** — Dealership encodes inventory (make, model, year, mileage, price, fuel type). Shoppers filter and sort thousands of listings entirely in-browser.

7. **Course catalog for universities/MOOCs** — Encode courses with department, credits, level, rating, instructor. Students explore offerings with instant filtering, no server dependency.

8. **Wine/beer/spirits catalog** — Encode tasting notes, region, varietal, ABV, price, rating. Enthusiasts facet-browse large catalogs from a static site.

9. **Healthcare provider directory** — Encode provider profiles (specialty, insurance accepted, rating, distance). Patients filter locally; artifacts rebuild nightly from the source DB.

10. **Parts/component catalog (industrial)** — Encode part specs (voltage, tolerance, package type, manufacturer). Engineers search thousands of components with range filters on electrical parameters.

11. **Event/conference schedule** — Encode sessions with track, speaker, time slot, room, difficulty level. Attendees build a personal schedule using client-side filters on a static PWA.

12. **Music library browser** — Encode track metadata (BPM, key, genre, duration, energy, danceability). DJs and producers facet-search their libraries without a running backend.

13. **Recipe database** — Encode recipes with cuisine, cook time, calories, dietary tags, ingredient count. Users filter by what they have and what fits their diet, all client-side.

14. **Sneaker/collectible marketplace** — Encode listings (brand, size, colorway, price, condition, release year). Collectors get instant multi-facet filtering on large inventories.

15. **SaaS feature comparison** — Encode software products with pricing tier, feature flags, category, rating, integrations. Buyers compare and filter hundreds of tools without API calls.

16. **Fitness exercise library** — Encode exercises with muscle group, equipment, difficulty, duration, calories burned. Users build workouts by filtering the full library offline.

17. **Geospatial point-of-interest search** — Encode POIs with lat/lon (as Int32 fixed-point), category, rating, price level. Mobile apps do coarse client-side filtering before expensive geo queries.

18. **Inventory management dashboard** — Encode warehouse SKUs (quantity, location, weight, category, supplier). Staff filter and sort thousands of items on low-bandwidth tablets.

19. **Academic paper explorer** — Encode paper metadata (year, citation count, journal, field, open-access flag). Researchers facet-browse corpora without Elasticsearch infrastructure.

20. **Game asset store** — Encode 3D models/textures with polygon count, format, category, license type, file size, rating. Developers filter large asset libraries with instant response from static hosting.
