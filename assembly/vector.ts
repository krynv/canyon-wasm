// CVector.as — note the unusual convention: rotate() measures angles from +Y, clockwise in
// screen space, and numRotation is the angle from "up" (0,-1) in degrees.
const PI: f64 = 3.141592653589793;

export class CVector {
  static readonly MIN_LENGTH: f64 = 0.001;

  constructor(public numX: f64, public numY: f64) {}

  get numLength(): f64 {
    return Math.sqrt(this.numX * this.numX + this.numY * this.numY);
  }

  set numLength(v: f64) {
    if (v < CVector.MIN_LENGTH) v = CVector.MIN_LENGTH;
    const len = this.numLength;
    // AS2: if(this.numLength) — false for 0 and NaN
    if (len != 0 && !isNaN(len)) {
      const k = v / len;
      this.numX *= k;
      this.numY *= k;
    }
  }

  get numRotation(): f64 {
    let r = 180 * this.getAngleWithXY(0, -1) / PI;
    if (this.numX < 0) r *= -1;
    return r;
  }

  makeCopy(): CVector {
    return new CVector(this.numX, this.numY);
  }

  rotate(angle: f64): void {
    // AS2: if(__numAngle) — false for 0 and NaN
    if (angle != 0 && !isNaN(angle)) {
      const a = Math.atan2(this.numX, this.numY) + angle;
      const len = this.numLength;
      this.numX = len * Math.sin(a);
      this.numY = len * Math.cos(a);
    }
  }

  getAngleWith(v: CVector): f64 {
    return Math.acos((this.numX * v.numX + this.numY * v.numY) / (this.numLength * v.numLength));
  }

  getAngleWithXY(x: f64, y: f64): f64 {
    return Math.acos((this.numX * x + this.numY * y) / (this.numLength * Math.sqrt(x * x + y * y)));
  }
}
