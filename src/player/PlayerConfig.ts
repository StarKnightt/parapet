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

  walkSpeed: 5.5,
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

  mouseSensitivity: 0.0021,
  pitchLimitDeg: 88,
} as const;

export const JUMP_SPEED = Math.sqrt(2 * PLAYER.gravity * PLAYER.jumpHeight);
