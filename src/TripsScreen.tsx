import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { isDone, legsForYear, yearsWithLegs, type Leg } from './db';
import LegRow from './LegRow';
import { isBusiness } from './purposes';
import { Btn, Chip, dayLabel, Header, makeUi, type Palette, useColors, useStyles } from './ui';

const business = (legs: Leg[]) =>
  legs.filter(isDone).filter((l) => isBusiness(l.purpose)).reduce((s, l) => s + (l.miles ?? 0), 0);

export default function TripsScreen(props: {
  onBack: () => void;
  onOpenLeg: (id: number) => void;
  onOpenDayMap: (dayId: number) => void;
  onAdd: () => void;
}) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const ui = useStyles(makeUi);
  const thisYear = String(new Date().getFullYear());
  const years = useMemo(() => {
    const ys = yearsWithLegs();
    return ys.includes(thisYear) ? ys : [thisYear, ...ys];
  }, [thisYear]);
  const [year, setYear] = useState(thisYear);
  const legs = useMemo(() => legsForYear(year), [year]);

  const sections = useMemo(() => {
    const byDate = new Map<string, Leg[]>();
    for (const l of legs) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
    return [...byDate.entries()].map(([date, data]) => ({
      date,
      data,
      miles: business(data),
      dayId: data.find((l) => l.day_id != null)?.day_id ?? null,
    }));
  }, [legs]);

  const total = business(legs);
  const personal = legs.filter((l) => !isBusiness(l.purpose)).reduce((s, l) => s + (l.miles ?? 0), 0);

  return (
    <View style={styles.screen}>
      <Header title="Trips" subtitle={`${year}: ${total.toFixed(1)} business mi${personal ? ` · ${personal.toFixed(1)} personal` : ''}`} onBack={props.onBack} />
      <SectionList
        sections={sections}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            {years.length > 1 && (
              <View style={styles.years}>
                {years.map((y) => (
                  <Chip key={y} label={y} selected={y === year} onPress={() => setYear(y)} />
                ))}
              </View>
            )}
            <Btn label="+ Add a drive by hand" kind="outline" onPress={props.onAdd} />
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No drives in {year}.</Text>}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHead}>
            <Text style={styles.dayTitle}>{dayLabel(section.date)}</Text>
            <Text style={styles.dayMiles}>{section.miles.toFixed(1)} business mi</Text>
            {section.dayId != null && (
              <Pressable onPress={() => props.onOpenDayMap(section.dayId!)} hitSlop={8}>
                <Text style={styles.link}>Map</Text>
              </Pressable>
            )}
          </View>
        )}
        renderItem={({ item }) => <LegRow leg={item} onPress={() => props.onOpenLeg(item.id)} />}
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { color: c.muted, fontSize: 15, marginTop: 16 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, backgroundColor: c.bg, paddingTop: 18, paddingBottom: 6 },
  dayTitle: { fontSize: 17, fontWeight: '700', color: c.text },
  dayMiles: { fontSize: 14, color: c.sub, flex: 1 },
  link: { fontSize: 15, color: c.accent, fontWeight: '700' },
});
