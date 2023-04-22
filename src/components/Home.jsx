import Carousel from "react-bootstrap/Carousel";
import One from "../assest/img/1.jpeg";
import Three from "../assest/img/3.jpeg";
import Four from "../assest/img/4.jpeg";
import Five from "../assest/img/5.jpg";
const Home = () => {
  return (
    <>
      <div className="bg-dark">
        <Carousel>
          <Carousel.Item interval={1500} style={{ maxHeight: '540px' }}>
            <img className="d-block w-100 " src={Four} alt="Second slide"
            />
            <Carousel.Caption className="fs-2 d-flex justify-content-center" style={{ flexDirection: 'column', alignItems: 'center' }}>
              <h3 style={{ background: '#040431', width: '150px' }}>Welcome</h3>
              <p style={{ background: '#040431', }}> to Cleaning Comes First</p>
            </Carousel.Caption>
          </Carousel.Item>
          <Carousel.Item interval={1500} style={{ maxHeight: '540px' }}>
            <img className="d-block w-100 " src={Three} alt="First slide"
            />
            <Carousel.Caption className="fs-2 d-flex justify-content-center" style={{ flexDirection: 'column', alignItems: 'center' }}>
              
              <p style={{ background: '#040431', fontSize: '25px' }} >Commercial Cleaning Service for Greater London.</p>
            </Carousel.Caption>
          </Carousel.Item>
          <Carousel.Item interval={1500} style={{ maxHeight: '540px' }}>
            <img className="d-block w-100 " src={One} alt="First slide"
            />
            <Carousel.Caption className="fs-2 d-flex justify-content-center" style={{ flexDirection: 'column', alignItems: 'center' }}>
              <h3 style={{ background: '#040431', width: '150px' }}>We pride </h3>
              <p style={{ background: '#040431', }}>ourselves on being courteous and professional in all we do.</p>
            </Carousel.Caption>
          </Carousel.Item>
          <Carousel.Item interval={1500} style={{ maxHeight: '540px', maxWidth: '100%' }}>
            <img className="d-block w-100" src={Five} style={{ height: '540px' }} alt="last slide" />
            <Carousel.Caption className="fs-2 d-flex justify-content-center" style={{ flexDirection: 'column', alignItems: 'center' }}>
              <h3 style={{ background: '#040431' }}>We offer a free inspection , free consultation,</h3>
              <p style={{ background: '#040431', }}>and a free written quotation without obligation.</p>
            </Carousel.Caption>
          </Carousel.Item>
        </Carousel>

      </div>
    </>
  );
};
export default Home;