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

  /** Shift held, or strafing / backpedalling without forward input. */
  walkSpeed: 5.5,
  /** Default forward speed (plain W). */
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

  /** Distance per footstep at walk / sprint; bob and footstep audio are driven by it. */
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
  /** How far beside the body we look for a wall. */
  wallProbe: 0.22,
  /** Minimum speed along the wall to attach. */
  wallMinSpeed: 4.0,
  /** Falling faster than this and you slap the wall instead of running it. */
  wallMaxFall: -7,
  /** Small upward kick on attach (m/s). */
  wallKick: 2.2,
  /** Gravity multiplier at attach, ramping to 1 by `wallGravityRamp` seconds. */
  wallGravityStart: 0.22,
  wallGravityRamp: 0.9,
  wallMaxTime: 1.6,
  /** Speed lost along the wall per second (m/s²). */
  wallDrag: 1.0,
  /** Fraction of upward velocity kept on attach (a fresh jump keeps most of its rise). */
  wallKeepUp: 0.85,
  /** Wall-jump: push away from the wall, and vertical as a fraction of a normal jump. */
  wallJumpPush: 5.2,
  wallJumpUp: 1.0,
  wallJumpKeep: 0.92,
  /** Vertical impulse multiplier per successive wall-jump in one airtime. */
  wallChainDecay: 0.72,
  /** After leaving a wall you cannot re-attach to the same one until grounded. */
  wallCooldown: 0.12,

  mouseSensitivity: 0.0021,
  pitchLimitDeg: 88,
} as const;

export const JUMP_SPEED = Math.sqrt(2 * PLAYER.gravity * PLAYER.jumpHeight);
