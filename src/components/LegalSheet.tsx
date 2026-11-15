import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Modal } from './Sheets';

/** A data source or service the app uses, with the notice its licence or terms ask for. */
interface Source {
  name: string;
  use: string;
  notice: string;
  license?: string;
  url: string;
}

const SOURCES: Source[] = [
  { name: 'OpenStreetMap', use: 'Kartendaten, Orte (POIs), Grundlage für Suche und Routing', notice: '© OpenStreetMap-Mitwirkende', license: 'Open Database License (ODbL) 1.0', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenFreeMap', use: 'Vektorkarten (Bikepath, Hell, Nacht) und Schriften', notice: 'OpenFreeMap © OpenMapTiles · Daten von OpenStreetMap', license: 'OpenMapTiles-Schema: CC BY 4.0 · Noto-Schriften: SIL Open Font License', url: 'https://openfreemap.org' },
  { name: 'CyclOSM', use: 'Kartenstil „Radkarte“', notice: '© CyclOSM · Kartendaten © OpenStreetMap-Mitwirkende', url: 'https://www.cyclosm.org' },
  { name: 'OpenStreetMap-Kacheln', use: 'Kartenstil „OpenStreetMap“', notice: '© OpenStreetMap-Mitwirkende', license: 'Kacheln: CC BY-SA 2.0', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenTopoMap', use: 'Kartenstil „Outdoor / Topo“', notice: 'Kartendarstellung © OpenTopoMap · Daten © OpenStreetMap-Mitwirkende, SRTM', license: 'CC BY-SA 3.0', url: 'https://opentopomap.org' },
  { name: 'Esri World Imagery', use: 'Kartenstil „Satellit“', notice: 'Bilder © Esri, Maxar, Earthstar Geographics und die GIS User Community', url: 'https://www.esri.com' },
  { name: 'Waymarked Trails', use: 'Ebenen „Radrouten“ und „MTB-Routen“', notice: '© waymarkedtrails.org · Daten © OpenStreetMap-Mitwirkende', license: 'CC BY-SA 3.0', url: 'https://waymarkedtrails.org' },
  {
    name: 'Terrain Tiles (Mapzen, AWS Open Data)',
    use: 'Höhen für 3D-Gelände, Relief und Höhenprofile',
    notice:
      'ArcticDEM: aus DigitalGlobe-Bildern, gefördert von der US National Science Foundation · Australien: © Commonwealth of Australia (Geoscience Australia) 2017 · Österreich: © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich · Kanada: enthält Informationen unter der Open Government Licence – Canada · Europa: erzeugt mit Copernicus-Daten, gefördert von der Europäischen Union – EU-DEM · Global: ETOPO1, U.S. National Oceanic and Atmospheric Administration · Mexiko: INEGI, Continental relief, 2016 · Neuseeland: Copyright 2011 Crown copyright (c) Land Information New Zealand und New Zealand Government · Norwegen: © Kartverket · Vereinigtes Königreich: © Environment Agency copyright and/or database right 2015 · USA 3DEP sowie global GMTED2010 und SRTM: U.S. Geological Survey',
    url: 'https://registry.opendata.aws/terrain-tiles/',
  },
  { name: 'BRouter', use: 'Routenberechnung; Vorlage für eigene Routenoptionen (Profil „trekking“)', notice: 'BRouter von Arndt Brenschede · Daten © OpenStreetMap-Mitwirkende', license: 'BRouter-Profile: MIT', url: 'https://github.com/abrensch/brouter' },
  { name: 'Photon (komoot)', use: 'Orts- und Adresssuche', notice: 'Photon von komoot · Daten © OpenStreetMap-Mitwirkende', url: 'https://photon.komoot.io' },
  { name: 'Open-Meteo', use: 'Wetter und Wind', notice: 'Wetterdaten von Open-Meteo.com', license: 'CC BY 4.0', url: 'https://open-meteo.com' },
];

interface Lib {
  name: string;
  version: string;
  license: string;
  url: string;
  text: string;
}

/** Profil → Rechtliches: data sources with their notices and the open-source licences. */
export default function LegalSheet() {
  const close = () => useStore.getState().setSheet(null);
  const [libs, setLibs] = useState<Lib[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // written by build/licenses-plugin.mjs; only exists in a build, not in `npm run dev`
    fetch(`${import.meta.env.BASE_URL}licenses.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setLibs)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Modal title="Rechtliches & Lizenzen" onClose={close} testid="legal-sheet">
      <p className="small muted" style={{ marginTop: 0 }}>
        Bikepath nutzt freie Daten und Dienste. Die folgenden Angaben machen die jeweiligen Lizenzen und Nutzungsbedingungen erforderlich.
      </p>

      <h3>Kartendaten und Dienste</h3>
      <div className="legal-list">
        {SOURCES.map((s) => (
          <div className="legal-item" key={s.name}>
            <div className="lbl">
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
            </div>
            <div className="small muted">{s.use}</div>
            <div className="small">{s.notice}</div>
            {s.license && <div className="small muted">Lizenz: {s.license}</div>}
          </div>
        ))}
      </div>

      <h3>Open-Source-Bibliotheken</h3>
      {libs ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>{libs.length} Pakete sind Teil der App. Antippen zeigt den Lizenztext.</p>
          <div className="legal-list" data-testid="legal-libs">
            {libs.map((l) => (
              <details className="legal-item" key={`${l.name}@${l.version}`}>
                <summary>
                  <span className="lbl">{l.name}</span> <span className="small muted">{l.version} · {l.license}</span>
                </summary>
                <div className="small"><a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a></div>
                <pre className="legal-text">{l.text || 'Kein Lizenztext im Paket enthalten.'}</pre>
              </details>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted">
          {failed ? 'Die Liste entsteht beim Bauen der App und ist in der Entwicklungsfassung nicht vorhanden.' : 'Wird geladen …'}
        </p>
      )}

      <h3>Bikepath</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Quellcode: <a href="https://github.com/jonnycamaro/bikepath" target="_blank" rel="noopener noreferrer">github.com/jonnycamaro/bikepath</a>
      </p>
    </Modal>
  );
}
