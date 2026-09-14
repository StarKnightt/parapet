/**
 * Every feel number in one place. Units: metres, seconds, m/s, m/s².
 *
 * Derived reach at these numbers (sanity for the level designer):
 *   jump apex 1.25 m, airtime 0.67 s, sprint-jump range ≈ 5.7 m flat, ≈ 6.5 m to a 1 m lower roof.
 */
export const PLAYER = {
  /** Half-width of the collision box (the body is 0.7 m wide). */
  radius: 0.35,
  height: 1.8,
  eyeHeight: 1.66,

  /**
   * Pure strafe / backpedal speed (A, D or S with no forward input). This is not a "walk"
   * mode: there is no key that slows the player down on purpose.
   */
  sideSpeed: 5.5,
  /** Forward speed: any W input (alone or with a strafe) runs at this. Running is the only pace. */
  sprintSpeed: 8.5,
  /** Ground acceleration / deceleration (m/s²). 8.5 m/s in ~0.14 s; stop in ~0.1 s. */
  groundAccel: 60,
  groundFriction: 85,
  /** Air steering. Cannot exceed max(current speed, target speed) so momentum is kept. */
  airAccel: 16,

  gravity: 22,
  terminalVelocity: 48,
  jumpHeight: 1.25,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  /** Kerbs and parapets up to this height are climbed automatically with no animation. */
  stepHeight: 0.42,

  /** Distance per footstep at side / sprint pace; bob and footstep audio are driven by it. */
  strideWalk: 2.3,
  strideSprint: 2.75,

  /** Landing classification by impact speed (m/s). */
  softLand: 7,
  hardLand: 13,

  /** Respawn when this far below the active checkpoint. */
  killDepth: 14,

  // --- mantle / vault ---------------------------------------------------------------
  /** Ledges up to this far above the feet are climbed (from the ground: 1.5 m; jumping: ~2.7 m). */
  mantleMaxHeight: 1.5,
  /** How far the body ends past the ledge face (from the face to the box's near side). */
  mantleInset: 0.12,
  mantleDurationMin: 0.22,
  mantleDurationMax: 0.46,
  /** Forward speed kept after a mantle, as a fraction of approach speed; clamped to [3, 7]. */
  mantleKeep: 0.8,
  /** How far past the lip we look for floor before keeping speed through a mantle. */
  mantleFloorReach: 0.6,
  /** Floor within this drop below the lip counts as "safe to run on". */
  mantleFloorDrop: 1.3,

  // --- slide ------------------------------------------------------------------------
  crouchHeight: 0.95,
  crouchSpeed: 2.6,
  /** Minimum ground speed to start a slide. */
  slideMinSpeed: 5.0,
  slideBoost: 1.8,
  slideMaxSpeed: 10.5,
  /** Low friction while the slide is "fresh", then it bites. */
  slideFreshTime: 0.6,
  slideFrictionFresh: 3.5,
  slideFriction: 11,
  /** Steering while sliding: velocity direction turns toward input at this many rad/s. */
  slideSteer: 1.4,
  slideEndSpeed: 2.6,
  slideCooldown: 0.25,

  // --- wall-run -----------------------------------------------------------------------
  // Shape of a run at sprint: the jump's own rise finishes (~0.3 s, ~+1 m, so the wall never
  // eats your jump), the wall holds you flat for ~0.45 s, then a gentle sag; ~1.4–1.6 s
  // usable, covering ~12 m. Horizontal speed is held.
  /** How far beside the body we look for a wall (was 0.22: a 25 cm gap missed the facade); also how far you can peel off before letting go. */
  wallProbe: 0.3,
  /** Pressing or looking into the wall pulls you onto it from this far; the gap closes over ~0.1 s. */
  wallAttract: 0.4,
  /** Minimum speed along the wall to attach. */
  wallMinSpeed: 4.0,
  /** Falling faster than this and you slap the wall instead of running it. */
  wallMaxFall: -7,
  /** Without a jump (ran off a ledge) you can still attach while pressing into the wall and falling slower than this. */
  wallFallAttach: -3,
  /** Rise on attach is clamped to [kick, maxRise]: at least a hop, never more than a jump's own rise. */
  wallKick: 2.6,
  wallMaxRise: 6.5,
  /** Fraction of upward velocity kept on attach (before the clamp above). */
  wallKeepUp: 0.85,
  /** Gravity multiplier while still rising: near full, so a fresh jump tops out in ~0.3 s (+1 m) instead of lobbing 2.5 m. */
  wallRiseGravity: 0.9,
  /** Gravity multiplier through the plateau (loses only ~0.6 m/s over it), ramping to 1 over `wallGravityRamp`. */
  wallGravityStart: 0.06,
  wallPlateau: 0.45,
  wallGravityRamp: 0.7,
  /** Hard cut; the sag has you falling at ~8 m/s by then anyway. */
  wallMaxTime: 1.7,
  /** Speed lost along the wall per second (m/s²). Was 1.0: a long run should not bleed speed. */
  wallDrag: 0.3,
  /** Speed gained along the wall on attach (m/s), capped at sprint + this. */
  wallAttachBoost: 0.5,
  /** Looking away from the wall by more than this (deg) starts peeling the run off toward the look direction... */
  wallSteerDead: 30,
  /** ...at up to this many deg/s of velocity turn (reached at `wallLookOff`). */
  wallSteer: 15,
  /** Looking away harder than this (deg) for `wallLookOffTime` releases the wall cleanly. */
  wallLookOff: 70,
  wallLookOffTime: 0.15,
  /** Wall-jump: push (m/s) along a blend of away-from-wall and the look direction (`wallJumpLookMix` of look). */
  wallJumpPush: 6.0,
  wallJumpLookMix: 0.45,
  /** Vertical as a fraction of a normal jump. */
  wallJumpUp: 1.0,
  /** Along-wall speed kept when aiming forward; aiming straight away drops it by `wallJumpTurn` so the jump really turns. */
  wallJumpKeep: 0.95,
  wallJumpTurn: 0.35,
  /** Horizontal speed cap after a wall-jump (the along-wall part is trimmed to fit). */
  wallJumpMaxSpeed: 10.5,
  /** Vertical impulse multiplier per successive wall-jump in one airtime. */
  wallChainDecay: 0.72,
  /** After leaving a wall you cannot re-attach to the same one until grounded. */
  wallCooldown: 0.12,

  mouseSensitivity: 0.0021,
  pitchLimitDeg: 88,
} as const;

export const JUMP_SPEED = Math.sqrt(2 * PLAYER.gravity * PLAYER.jumpHeight);
