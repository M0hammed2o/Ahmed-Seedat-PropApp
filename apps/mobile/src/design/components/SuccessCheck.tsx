import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { useTheme } from '../theme';

/** A springy checkmark-in-a-circle used after a successful upload/match/save action. */
export function SuccessCheck({ size = 72 }: { size?: number }) {
  const { color } = useTheme();
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }).start();
  }, [scale]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color.statusPaid,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale }],
      }}
      accessibilityLabel="Success"
    >
      <View>
        <Text style={{ fontSize: size * 0.42, color: color.accentContrast, fontWeight: '700' }}>
          ✓
        </Text>
      </View>
    </Animated.View>
  );
}
