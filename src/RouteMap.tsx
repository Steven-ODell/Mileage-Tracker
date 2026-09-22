import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { MAP_HTML } from './generated/mapHtml';
import type { LngLat, Payload } from './mapData';

// The MapLibre page in a WebView. Data goes in via injected JS; the only
// thing coming back is the trim slider position.
export default function RouteMap(props: {
  payload: Payload;
  trim?: { full: LngLat[]; index: number } | null;
  onTrim?: (index: number) => void;
}) {
  const web = useRef<WebView>(null);
  const loaded = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const run = (js: string) => {
    if (loaded.current) web.current?.injectJavaScript(`${js}; true;`);
  };

  useEffect(() => run(`window.setData(${JSON.stringify(props.payload)})`), [props.payload]);

  const trimOn = !!props.trim;
  useEffect(() => {
    const t = latest.current.trim;
    if (t) run(`window.startTrim(${JSON.stringify(t.full)}, ${t.index})`);
    else run('window.stopTrim()');
  }, [trimOn]);

  return (
    <WebView
      ref={web}
      style={{ flex: 1 }}
      originWhitelist={['*']}
      source={{ html: MAP_HTML, baseUrl: 'https://localhost/' }}
      onLoadEnd={() => {
        loaded.current = true;
        const p = latest.current;
        run(`window.setData(${JSON.stringify(p.payload)})`);
        if (p.trim) run(`window.startTrim(${JSON.stringify(p.trim.full)}, ${p.trim.index})`);
      }}
      onMessage={(e) => {
        try {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'trim') latest.current.onTrim?.(m.i);
        } catch {}
      }}
      javaScriptEnabled
      setSupportMultipleWindows={false}
    />
  );
}
