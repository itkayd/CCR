import banner from '../assest/img/04sky.jpg'
const Logo = () => {
  return (
    <>
      <header >
        <div style={{ userSelect: "none" }}>

          <img src={banner} alt="" style={{ width: '100%', height: '100px', objectFit: 'fit', }} />

        </div>

      </header>
    </>
  );
};

export default Logo;
