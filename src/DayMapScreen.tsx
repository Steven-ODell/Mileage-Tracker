import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { legsForDay } from './db';
import { buildPayload } from './mapData';
import RouteMap from './RouteMap';
import { dayLabel, Header, useColors } from './ui';

function load(dayId: number) {
  const legs = legsForDay(dayId);
  return { ...buildPayload(legs, 'day'), title: legs[0] ? `Day of ${dayLabel(legs[0].date)}` : 'Map' };
}

export default function DayMapScreen({ dayId, onBack }: { dayId: number; onBack: () => void }) {
  const c = useColors();
  const [data, setData] = useState(() => load(dayId));

  // While a leg is still being driven, redraw as points come in.
  useEffect(() => {
    if (!data.live) return;
    const t = setInterval(() => setData(load(dayId)), 5000);
    return () => clearInterval(t);
  }, [data.live, dayId]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={data.title} subtitle={data.summary + (data.live ? ' · live' : '')} onBack={onBack} />
      <RouteMap payload={data.payload} />
    </View>
  );
}
