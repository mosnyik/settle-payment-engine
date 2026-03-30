interface LogoProps {
  white?: boolean;
  className?: string;
}

const Logo = ({ white = false, className = "" }: LogoProps) => {
  return (
    <img
      src="/logos/simple_logo.png"
      alt="2Settle"
      className={`h-8 w-auto ${className}`}
      style={white ? { filter: "brightness(0) invert(1)" } : undefined}
    />
  );
};

export default Logo;
