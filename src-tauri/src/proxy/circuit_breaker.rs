use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Instant;

/// Circuit breaker state for API entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

/// Adaptive Circuit Breaker for API entries with exponential backoff and jitter.
/// State is kept in memory only (not persisted).
///
/// State transitions:
/// - Closed → Open: when consecutive failures reach `threshold`.
/// - Open → HalfOpen: when cooldown (base delay * 2^(opens-1) ± jitter) elapses.
/// - HalfOpen → Closed: on successful probe request.
/// - HalfOpen → Open: on failed probe request (increases backoff multiplier).
pub struct CircuitBreaker {
    state: Arc<RwLock<CircuitState>>,
    consecutive_failures: Arc<AtomicU32>,
    consecutive_opens: Arc<AtomicU32>,
    last_opened_at: Arc<RwLock<Option<Instant>>>,
    last_effective_delay_secs: Arc<AtomicU64>,
    base_recovery_secs: u64,
    max_recovery_secs: u64,
    jitter_ratio: f64,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with default base recovery seconds.
    pub fn new(recovery_secs: u64) -> Self {
        let max = recovery_secs.saturating_mul(30).max(1800);
        Self::with_config(recovery_secs, max, 0.2)
    }

    /// Create a circuit breaker with custom adaptive backoff configuration.
    pub fn with_config(base_recovery_secs: u64, max_recovery_secs: u64, jitter_ratio: f64) -> Self {
        let base = base_recovery_secs.max(1);
        let max = max_recovery_secs.max(base);
        let jitter = jitter_ratio.clamp(0.0, 0.5);

        Self {
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            consecutive_failures: Arc::new(AtomicU32::new(0)),
            consecutive_opens: Arc::new(AtomicU32::new(0)),
            last_opened_at: Arc::new(RwLock::new(None)),
            last_effective_delay_secs: Arc::new(AtomicU64::new(base)),
            base_recovery_secs: base,
            max_recovery_secs: max,
            jitter_ratio: jitter,
        }
    }

    /// Calculate adaptive backoff delay with exponential growth and bounded jitter.
    /// Formula:
    ///   raw_delay = min(base_recovery_secs * 2^(consecutive_opens - 1), max_recovery_secs)
    ///   jitter = raw_delay * random_factor (-jitter_ratio .. +jitter_ratio)
    ///   effective_delay = clamp(raw_delay + jitter, base_recovery_secs, max_recovery_secs)
    pub fn calculate_backoff_delay(&self) -> u64 {
        let opens = self.consecutive_opens.load(Ordering::Relaxed).max(1);
        let shift = (opens - 1).min(10); // cap exponent to prevent overflow
        let multiplier = 1u64.checked_shl(shift).unwrap_or(1024);
        let raw_delay = self
            .base_recovery_secs
            .saturating_mul(multiplier)
            .min(self.max_recovery_secs);

        if self.jitter_ratio <= 0.0 {
            return raw_delay;
        }

        // Lightweight pseudo-random generator using high-resolution time nanos
        let nanos = Instant::now().elapsed().as_nanos() as u64;
        let pseudo_rand = (nanos.wrapping_mul(6364136223846793005).wrapping_add(1) >> 33) as f64
            / (u32::MAX as f64);
        // Map pseudo_rand in [0.0, 1.0] to offset in [-jitter_ratio, +jitter_ratio]
        let offset_factor = (pseudo_rand * 2.0 - 1.0) * self.jitter_ratio;
        let delta = (raw_delay as f64 * offset_factor).round() as i64;

        let effective = (raw_delay as i64 + delta)
            .max(self.base_recovery_secs as i64)
            .min(self.max_recovery_secs as i64) as u64;

        self.last_effective_delay_secs
            .store(effective, Ordering::Relaxed);
        effective
    }

    /// Check whether the circuit breaker allows traffic.
    pub fn is_available(&self) -> bool {
        let state = match self.state.try_read() {
            Ok(s) => *s,
            Err(_) => return false, // Lock contention → treat as unavailable for safety
        };

        match state {
            CircuitState::Closed | CircuitState::HalfOpen => true,
            CircuitState::Open => {
                let last_open = match self.last_opened_at.try_read() {
                    Ok(guard) => *guard,
                    Err(_) => return false,
                };

                if let Some(opened_at) = last_open {
                    let required_cooldown = self.calculate_backoff_delay();
                    if opened_at.elapsed().as_secs() >= required_cooldown {
                        if let Ok(mut s) = self.state.try_write() {
                            *s = CircuitState::HalfOpen;
                        }
                        return true;
                    }
                }
                false
            }
        }
    }

    /// Record a successful request. Resets failure counters, open counters, and transitions to Closed.
    pub fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.consecutive_opens.store(0, Ordering::Relaxed);
        if let Ok(mut state) = self.state.try_write() {
            *state = CircuitState::Closed;
        }
    }

    /// Record a failed request.
    /// If in HalfOpen state, transitions back to Open and increases exponential backoff.
    /// If in Closed state, increments failures and trips to Open when reaching `threshold`.
    pub fn record_failure(&self, threshold: u32) {
        let current_state = self.get_state();

        if current_state == CircuitState::HalfOpen {
            // Failed recovery probe in HalfOpen state → trip back to Open with increased backoff
            self.consecutive_opens.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut state) = self.state.try_write() {
                *state = CircuitState::Open;
            }
            if let Ok(mut last_opened) = self.last_opened_at.try_write() {
                *last_opened = Some(Instant::now());
            }
            return;
        }

        let failures = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
        if failures >= threshold {
            self.consecutive_opens.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut state) = self.state.try_write() {
                *state = CircuitState::Open;
            }
            if let Ok(mut last_opened) = self.last_opened_at.try_write() {
                *last_opened = Some(Instant::now());
            }
        }
    }

    /// Get current state of circuit breaker.
    pub fn get_state(&self) -> CircuitState {
        self.state
            .try_read()
            .map(|s| *s)
            .unwrap_or(CircuitState::Closed)
    }

    /// Get total consecutive failures recorded.
    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures.load(Ordering::Relaxed)
    }

    /// Get total consecutive open cycles recorded.
    pub fn consecutive_opens(&self) -> u32 {
        self.consecutive_opens.load(Ordering::Relaxed)
    }

    /// Get last calculated effective recovery delay in seconds.
    pub fn get_effective_recovery_secs(&self) -> u64 {
        self.last_effective_delay_secs.load(Ordering::Relaxed)
    }

    /// Update base recovery seconds at runtime (e.g., when user alters settings).
    pub fn set_recovery_secs(&mut self, secs: u64) {
        self.base_recovery_secs = secs.max(1);
        if self.max_recovery_secs < self.base_recovery_secs {
            self.max_recovery_secs = self.base_recovery_secs.saturating_mul(30).max(1800);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_is_closed() {
        let cb = CircuitBreaker::new(30);
        assert_eq!(cb.get_state(), CircuitState::Closed);
        assert!(cb.is_available());
        assert_eq!(cb.consecutive_failures(), 0);
        assert_eq!(cb.consecutive_opens(), 0);
    }

    #[test]
    fn test_failure_threshold_trips_to_open() {
        let cb = CircuitBreaker::new(30);
        cb.record_failure(5);
        assert_eq!(cb.consecutive_failures(), 1);
        assert_eq!(cb.get_state(), CircuitState::Closed);

        for _ in 0..4 {
            cb.record_failure(5);
        }
        assert_eq!(cb.consecutive_failures(), 5);
        assert_eq!(cb.get_state(), CircuitState::Open);
        assert_eq!(cb.consecutive_opens(), 1);
    }

    #[test]
    fn test_adaptive_exponential_growth_and_max_cap() {
        let cb = CircuitBreaker::with_config(10, 50, 0.0); // 0 jitter for deterministic testing
        cb.record_failure(1); // 1st open -> 10 * 2^0 = 10s
        assert_eq!(cb.calculate_backoff_delay(), 10);

        cb.record_failure(1); // 2nd open -> 10 * 2^1 = 20s
        assert_eq!(cb.calculate_backoff_delay(), 20);

        cb.record_failure(1); // 3rd open -> 10 * 2^2 = 40s
        assert_eq!(cb.calculate_backoff_delay(), 40);

        cb.record_failure(1); // 4th open -> 10 * 2^3 = 80s -> capped at max 50s
        assert_eq!(cb.calculate_backoff_delay(), 50);
    }

    #[test]
    fn test_jitter_bounds() {
        let base = 100u64;
        let jitter_ratio = 0.2f64; // ±20%
        let cb = CircuitBreaker::with_config(base, 1000, jitter_ratio);
        cb.consecutive_opens.store(1, Ordering::Relaxed);

        for _ in 0..50 {
            let delay = cb.calculate_backoff_delay();
            assert!(delay >= 80, "delay {} below lower bound 80", delay);
            assert!(delay <= 120, "delay {} above upper bound 120", delay);
        }
    }

    #[test]
    fn test_reset_after_success() {
        let cb = CircuitBreaker::new(30);
        cb.record_failure(1);
        assert_eq!(cb.get_state(), CircuitState::Open);
        assert_eq!(cb.consecutive_opens(), 1);

        cb.record_success();
        assert_eq!(cb.get_state(), CircuitState::Closed);
        assert_eq!(cb.consecutive_failures(), 0);
        assert_eq!(cb.consecutive_opens(), 0);
    }

    #[test]
    fn test_failed_recovery_in_half_open() {
        let cb = CircuitBreaker::with_config(10, 100, 0.0);
        cb.record_failure(1); // Open cycle 1
        assert_eq!(cb.consecutive_opens(), 1);

        // Manually simulate HalfOpen state
        if let Ok(mut s) = cb.state.try_write() {
            *s = CircuitState::HalfOpen;
        }
        assert_eq!(cb.get_state(), CircuitState::HalfOpen);

        // Failed probe in HalfOpen
        cb.record_failure(5);
        assert_eq!(cb.get_state(), CircuitState::Open);
        assert_eq!(cb.consecutive_opens(), 2);
        assert_eq!(cb.calculate_backoff_delay(), 20); // 10 * 2^1 = 20s
    }

    #[test]
    fn test_successful_recovery_in_half_open() {
        let cb = CircuitBreaker::new(30);
        cb.record_failure(1);
        if let Ok(mut s) = cb.state.try_write() {
            *s = CircuitState::HalfOpen;
        }

        cb.record_success();
        assert_eq!(cb.get_state(), CircuitState::Closed);
        assert_eq!(cb.consecutive_opens(), 0);
    }
}

