import React, { useEffect, useRef } from 'react';
import { Animated, type ViewStyle } from 'react-native';

export interface FadeSlideInProps {
  children: React.ReactNode;
  delay?: number;
  style?: ViewStyle;
  distance?: number;
}

/** Standard entrance for cards/sections — subtle fade + upward slide, staggerable via `delay`. */
export function FadeSlideIn({ children, delay = 0, style, distance = 12 }: FadeSlideInProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
